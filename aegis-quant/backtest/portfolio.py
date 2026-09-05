"""Tracks the equity curve across a sequence of trades and computes
summary statistics (net P&L, win rate, max drawdown, Sharpe)."""

import math
from typing import List


class Portfolio:
    def __init__(self, starting_capital: float):
        self.starting_capital = starting_capital
        self.capital = starting_capital
        self.equity_curve: List[float] = [starting_capital]
        self.trade_pnls: List[float] = []  # only actual trades (non-zero decisions)
        self.total_decisions = 0
        self.blocked_or_no_signal = 0

    def record_step(self, pnl_usd: float, was_trade: bool) -> None:
        self.total_decisions += 1
        if was_trade:
            self.capital += pnl_usd
            self.trade_pnls.append(pnl_usd)
        else:
            self.blocked_or_no_signal += 1
        self.equity_curve.append(self.capital)

    def net_pnl_usd(self) -> float:
        return self.capital - self.starting_capital

    def net_pnl_pct(self) -> float:
        if self.starting_capital == 0:
            return 0.0
        return (self.capital - self.starting_capital) / self.starting_capital * 100.0

    def win_rate_pct(self) -> float:
        if not self.trade_pnls:
            return 0.0
        wins = sum(1 for p in self.trade_pnls if p > 0)
        return wins / len(self.trade_pnls) * 100.0

    def max_drawdown_pct(self) -> float:
        if len(self.equity_curve) < 2:
            return 0.0
        peak = self.equity_curve[0]
        max_dd = 0.0
        for value in self.equity_curve:
            if value > peak:
                peak = value
            if peak <= 0:
                continue
            dd = (peak - value) / peak * 100.0
            if dd > max_dd:
                max_dd = dd
        return max_dd

    def sharpe_ratio(self) -> float:
        if len(self.trade_pnls) < 2:
            return 0.0
        mean = sum(1 for p in self.trade_pnls if p > 0)
        mean = sum(self.trade_pnls) / len(self.trade_pnls)
        variance = sum((p - mean) ** 2 for p in self.trade_pnls) / (len(self.trade_pnls) - 1)
        std_dev = math.sqrt(variance)
        if std_dev == 0:
            return 0.0
        return mean / std_dev

    def summary(self) -> dict:
        return {
            "starting_capital": self.starting_capital,
            "ending_capital": self.capital,
            "net_pnl_usd": self.net_pnl_usd(),
            "net_pnl_pct": self.net_pnl_pct(),
            "num_trades": len(self.trade_pnls),
            "num_blocked_or_no_signal": self.blocked_or_no_signal,
            "total_decisions": self.total_decisions,
            "win_rate_pct": self.win_rate_pct(),
            "max_drawdown_pct": self.max_drawdown_pct(),
            "sharpe_ratio": self.sharpe_ratio(),
        }
