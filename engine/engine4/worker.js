'use strict';

/**
 * Engine #4 worker — process closed bars chronologically (replay or forward).
 * Flow: Available candles at T → signal → next-open entry → monitor → exit → journal
 */

const crypto = require('crypto');
const config = require('./config');
const strategy = require('./strategy');
const execution = require('./execution');
const journal = require('./journal');
const metrics = require('./metrics');
const notifications = require('./notifications');

function id(prefix, parts) {
  const h = crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);
  return `${prefix}_${h}`;
}

function iso(ts) {
  return new Date(ts).toISOString();
}

/**
 * Process one symbol's bars from state.last_bar_ts forward.
 * bars must be sorted closed candles only.
 */
async function processSymbol(symbol, bars, state, opts = {}) {
  const notify = opts.notify !== false;
  if (!bars.length) return state;

  let lastTs = state.last_bar_ts[symbol] || 0;
  // Find starting index
  let startIdx = 0;
  for (let i = 0; i < bars.length; i++) {
    if (bars[i].ot > lastTs) {
      startIdx = i;
      break;
    }
    startIdx = i + 1;
  }

  for (let i = startIdx; i < bars.length; i++) {
    const bar = bars[i];
    const window = bars.slice(0, i + 1);

    // 1) Pending signal → entry at this bar open
    if (state.pending_signals[symbol] && !state.open_positions[symbol]) {
      const sig = state.pending_signals[symbol];
      const fill = execution.entryFill(bar.o);
      const notional = execution.sleeveNotional(state.equity);
      const trade_id = id('tr', [sig.signal_id, String(bar.ot), symbol]);
      if (!journal.hasSeen(state, 'seen_trade_ids', trade_id)) {
        const stop = fill.price - sig.stopDistance;
        const trade = {
          trade_id,
          signal_id: sig.signal_id,
          symbol,
          strategy_version: config.STRATEGY_VERSION,
          strategy_commit: config.STRATEGY_COMMIT,
          signal_time: sig.signal_time,
          entry_time: iso(bar.ot),
          entry_price: fill.price,
          initial_stop: stop,
          current_stop: stop,
          exit_time: null,
          exit_price: null,
          exit_reason: null,
          exit_resolution: null,
          gross_pnl: null,
          fees: null,
          slippage: null,
          net_pnl: null,
          return_pct: null,
          holding_time: null,
          position_size: notional,
          status: 'OPEN',
          mode: 'VIRTUAL',
        };
        journal.recordTrade(trade);
        journal.markSeen(state, 'seen_trade_ids', trade_id);
        state.open_positions[symbol] = trade;
        if (notify) await notifications.notifyOpen(trade, state);
      }
      delete state.pending_signals[symbol];
    }

    // 2) Manage open position on this closed bar
    if (state.open_positions[symbol]) {
      const pos = state.open_positions[symbol];
      const exitEval = strategy.evaluateExit(window, i, pos.entry_price, pos.current_stop);
      if (exitEval) {
        const fill = execution.exitFill(exitEval.exitPriceHint, exitEval.reason);
        const rets = execution.netReturnLong(pos.entry_price, fill.price);
        const gross_pnl = pos.position_size * rets.gross;
        const fees = pos.position_size * rets.fees;
        // approximate slippage cost embedded in prices; report as notional * 2 * slip
        const slippage = pos.position_size * (2 * config.SLIPPAGE_PER_SIDE);
        const net_pnl = pos.position_size * rets.net;
        const entryTs = Date.parse(pos.entry_time);
        const holdDays = (bar.ot - entryTs) / 86400000;
        const closed = {
          ...pos,
          exit_time: iso(bar.ot),
          exit_price: fill.price,
          exit_reason: exitEval.reason,
          exit_resolution: exitEval.resolution || null,
          gross_pnl,
          fees,
          slippage,
          net_pnl,
          return_pct: rets.net,
          holding_time: holdDays,
          status: 'CLOSED',
        };
        journal.recordTrade(closed);
        state.equity += net_pnl;
        state.peak_equity = Math.max(state.peak_equity, state.equity);
        const dd = state.peak_equity > 0 ? (state.peak_equity - state.equity) / state.peak_equity : 0;
        state.max_drawdown = Math.max(state.max_drawdown, dd);
        journal.recordEquitySnapshot({
          timestamp: iso(bar.ot),
          equity: state.equity,
          peak: state.peak_equity,
          drawdown: dd,
          trade_id: closed.trade_id,
          symbol,
        });
        delete state.open_positions[symbol];
        if (notify) await notifications.notifyClose(closed, state);
      }
    }

    // 3) New signal on this close (only if flat and no pending)
    if (!state.paused && !state.open_positions[symbol] && !state.pending_signals[symbol]) {
      const sigEval = strategy.evaluateSignalAtClose(window, i);
      if (sigEval) {
        const signal_id = id('sig', [symbol, String(bar.ot), config.STRATEGY_VERSION]);
        if (!journal.hasSeen(state, 'seen_signal_ids', signal_id)) {
          const signal = {
            signal_id,
            symbol,
            side: sigEval.side,
            signal_time: iso(bar.ot),
            strategy_version: config.STRATEGY_VERSION,
            strategy_commit: config.STRATEGY_COMMIT,
            entry_level: 'NEXT_OPEN',
            stop_level: null, // set at entry from fill - stopDistance
            stopDistance: sigEval.stopDistance,
            N: sigEval.N,
            donchian_level: sigEval.donchianLevel,
            status: 'PENDING_NEXT_OPEN',
          };
          // provisional stop reference from close (actual stop set at entry fill)
          signal.stop_level = bar.c - sigEval.stopDistance;
          journal.recordSignal(signal);
          journal.markSeen(state, 'seen_signal_ids', signal_id);
          state.pending_signals[symbol] = signal;
          if (notify) await notifications.notifySignal(signal, state);
        }
      }
    }

    state.last_bar_ts[symbol] = bar.ot;
  }

  return state;
}

async function runReplay(barsBySymbol, opts = {}) {
  journal.ensureDirs();
  let state = opts.fresh
    ? {
        version: 1,
        strategy_version: config.STRATEGY_VERSION,
        open_positions: {},
        pending_signals: {},
        seen_signal_ids: [],
        seen_trade_ids: [],
        notified_event_ids: [],
        equity: config.INITIAL_CAPITAL,
        peak_equity: config.INITIAL_CAPITAL,
        max_drawdown: 0,
        last_bar_ts: {},
        paused: false,
        pause_reason: null,
      }
    : journal.loadState();

  journal.audit('SYSTEM_RESTART', { mode: 'REPLAY', equity: state.equity });

  for (const symbol of config.SYMBOLS) {
    const bars = barsBySymbol[symbol] || [];
    state = await processSymbol(symbol, bars, state, { notify: opts.notify === true });
  }
  journal.saveState(state);
  return state;
}

function buildDailyReport(state) {
  const closed = journal.closedTrades();
  const sum = metrics.summarizeClosed(closed);
  const today = new Date().toISOString().slice(0, 10);
  const closedToday = closed.filter((t) => (t.exit_time || '').startsWith(today));
  return {
    date: today,
    signals_today: journal.allSignals().filter((s) => (s.signal_time || '').startsWith(today)).length,
    opened_today: journal.allTrades().filter((t) => (t.entry_time || '').startsWith(today)).length,
    closed_today_n: closedToday.length,
    closed_today: closedToday,
    open_positions: Object.keys(state.open_positions || {}).length,
    today_pnl: closedToday.reduce((s, t) => s + (t.net_pnl || 0), 0),
    total_pnl: state.equity - config.INITIAL_CAPITAL,
    win_rate: sum.win_rate,
    trades: sum.trades,
    pf: sum.profit_factor,
    max_dd: state.max_drawdown,
  };
}

module.exports = {
  processSymbol,
  runReplay,
  buildDailyReport,
  id,
};
