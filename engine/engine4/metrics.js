'use strict';

function summarizeClosed(trades) {
  const closed = (trades || []).filter((t) => t.status === 'CLOSED');
  if (!closed.length) {
    return {
      trades: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      gross_pnl: 0,
      fees: 0,
      slippage: 0,
      net_pnl: 0,
      profit_factor: 0,
      expectancy: 0,
      avg_win: 0,
      avg_loss: 0,
      avg_hold: 0,
      median_hold: 0,
    };
  }
  const wins = closed.filter((t) => t.net_pnl > 0);
  const losses = closed.filter((t) => t.net_pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.net_pnl, 0);
  const gl = Math.abs(losses.reduce((s, t) => s + t.net_pnl, 0));
  const holds = closed.map((t) => t.holding_time || 0).sort((a, b) => a - b);
  return {
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: (100 * wins.length) / closed.length,
    gross_pnl: closed.reduce((s, t) => s + (t.gross_pnl || 0), 0),
    fees: closed.reduce((s, t) => s + (t.fees || 0), 0),
    slippage: closed.reduce((s, t) => s + (t.slippage || 0), 0),
    net_pnl: closed.reduce((s, t) => s + (t.net_pnl || 0), 0),
    profit_factor: gl > 0 ? gw / gl : gw > 0 ? 99 : 0,
    expectancy: closed.reduce((s, t) => s + t.net_pnl, 0) / closed.length,
    avg_win: wins.length ? gw / wins.length : 0,
    avg_loss: losses.length ? losses.reduce((s, t) => s + t.net_pnl, 0) / losses.length : 0,
    avg_hold: holds.reduce((a, b) => a + b, 0) / holds.length,
    median_hold: holds[Math.floor(holds.length / 2)],
  };
}

function bySymbol(trades) {
  const map = {};
  for (const t of trades || []) {
    if (!map[t.symbol]) map[t.symbol] = [];
    map[t.symbol].push(t);
  }
  const out = {};
  for (const [sym, list] of Object.entries(map)) {
    out[sym] = summarizeClosed(list);
  }
  return out;
}

module.exports = { summarizeClosed, bySymbol };
