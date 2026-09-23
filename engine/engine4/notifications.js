'use strict';

const config = require('./config');
const journal = require('./journal');

async function sendTelegram(text, eventId, state) {
  if (eventId && journal.hasSeen(state, 'notified_event_ids', eventId)) {
    return { skipped: true, reason: 'duplicate' };
  }
  const token = process.env[config.TELEGRAM.tokenEnv];
  const chatId = process.env[config.TELEGRAM.chatIdEnv];
  if (!token || !chatId) {
    // Offline / test mode: audit only
    journal.audit('TELEGRAM_SKIPPED', { event_id: eventId, preview: text.slice(0, 200) });
    if (eventId) journal.markSeen(state, 'notified_event_ids', eventId);
    return { skipped: true, reason: 'no_credentials' };
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    const body = await res.json().catch(() => ({}));
    journal.audit('TELEGRAM_SENT', { event_id: eventId, ok: res.ok, body });
    if (eventId) journal.markSeen(state, 'notified_event_ids', eventId);
    return { ok: res.ok, body };
  } catch (err) {
    journal.audit('TELEGRAM_FAIL', { event_id: eventId, error: String(err.message || err) });
    return { ok: false, error: String(err.message || err) };
  }
}

function fmtPct(x) {
  return `${(x * 100).toFixed(2)}%`;
}

function fmtNum(x, d = 2) {
  return Number(x).toFixed(d);
}

async function notifySignal(signal, state) {
  const text = [
    '🐢 TURTLE SIGNAL',
    '',
    `Symbol: ${signal.symbol}`,
    `Signal: ${signal.side}`,
    `Time: ${signal.signal_time}`,
    '',
    `Donchian 20: ${fmtNum(signal.donchian_level, 4)}`,
    `N: ${fmtNum(signal.N, 4)}`,
    `Entry: NEXT OPEN`,
    `Initial Stop: ${fmtNum(signal.stop_level, 4)}`,
    '',
    `Signal ID: ${signal.signal_id}`,
    `Strategy Version: ${signal.strategy_version}`,
    '',
    '⚠️ Virtual Forward Test — no real order.',
  ].join('\n');
  return sendTelegram(text, `sig:${signal.signal_id}`, state);
}

async function notifyOpen(trade, state) {
  const text = [
    '🐢 TRADE OPENED',
    '',
    `Symbol: ${trade.symbol}`,
    `Entry: ${fmtNum(trade.entry_price, 4)}`,
    `Stop: ${fmtNum(trade.initial_stop, 4)}`,
    `Position notional: ${fmtNum(trade.position_size, 2)} USDT`,
    `Signal ID: ${trade.signal_id}`,
    `Trade ID: ${trade.trade_id}`,
    '',
    'Mode: VIRTUAL',
  ].join('\n');
  return sendTelegram(text, `open:${trade.trade_id}`, state);
}

async function notifyClose(trade, state) {
  const result = trade.net_pnl > 0 ? 'WIN' : 'LOSS';
  const text = [
    '🐢 TRADE CLOSED',
    '',
    `Symbol: ${trade.symbol}`,
    `Entry: ${fmtNum(trade.entry_price, 4)}`,
    `Exit: ${fmtNum(trade.exit_price, 4)}`,
    `Reason: ${String(trade.exit_reason).toUpperCase()}`,
    '',
    `Gross PnL: ${fmtNum(trade.gross_pnl, 2)}`,
    `Fees: ${fmtNum(trade.fees, 2)}`,
    `Slippage: ${fmtNum(trade.slippage, 2)}`,
    `Net PnL: ${fmtNum(trade.net_pnl, 2)}`,
    `Return: ${fmtPct(trade.return_pct)}`,
    `Hold: ${fmtNum(trade.holding_time, 1)} days`,
    '',
    `Result: ${result}`,
  ].join('\n');
  return sendTelegram(text, `close:${trade.trade_id}`, state);
}

async function notifyDaily(report, state) {
  const closedLines = (report.closed_today || [])
    .map((t) => `${t.symbol} → ${fmtPct(t.return_pct)}`)
    .join('\n') || '—';
  const text = [
    '🐢 TURTLE FORWARD TEST',
    '',
    `Date: ${report.date}`,
    '',
    `Signals today: ${report.signals_today}`,
    `New trades: ${report.opened_today}`,
    `Closed trades: ${report.closed_today_n}`,
    '',
    `Open positions: ${report.open_positions}`,
    '',
    'Closed:',
    closedLines,
    '',
    `Today PnL: ${fmtNum(report.today_pnl, 2)} USDT`,
    `Total PnL: ${fmtNum(report.total_pnl, 2)} USDT`,
    '',
    `Win rate: ${fmtNum(report.win_rate, 1)}%`,
    `Trades: ${report.trades}`,
    `PF: ${fmtNum(report.pf, 2)}`,
    '',
    `Max DD: ${fmtNum(report.max_dd * 100, 1)}%`,
    '',
    'Status:',
    'FORWARD TEST ACTIVE',
  ].join('\n');
  return sendTelegram(text, `daily:${report.date}`, state);
}

async function notifyDataIssue(symbol, issue, state) {
  const text = [
    '⚠️ FORWARD TEST DATA ISSUE',
    '',
    `Symbol: ${symbol}`,
    `Issue: ${issue}`,
    `Time: ${new Date().toISOString()}`,
    '',
    'Action:',
    'SIGNAL GENERATION PAUSED',
  ].join('\n');
  return sendTelegram(text, `data:${symbol}:${issue}:${Date.now()}`, state);
}

module.exports = {
  sendTelegram,
  notifySignal,
  notifyOpen,
  notifyClose,
  notifyDaily,
  notifyDataIssue,
};
