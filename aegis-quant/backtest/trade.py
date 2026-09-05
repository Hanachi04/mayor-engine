"""Simulates a single trade's outcome: entry at one candle's close, exit
at a later candle's close (per EXIT_HORIZON), net of fees and slippage.

Position sizing: the DRL layer's `risk_fraction` (0..1) is treated as the
fraction of current capital committed to the trade's notional size — no
leverage is applied beyond that. This keeps the backtest's answer to
"does this make money" conservative and easy to reason about.
"""

from typing import Optional


def compute_pnl_usd(
    direction: str,
    entry_price: float,
    exit_price: float,
    capital: float,
    risk_fraction: float,
    fee_pct: float,
    slippage_pct: float,
) -> float:
    """Return the trade's net P&L in USD.

    `direction` must be "LONG" or "SHORT". Fees and slippage are each
    applied once on entry and once on exit (round-trip), proportional to
    the position's notional size.
    """
    if direction not in ("LONG", "SHORT"):
        raise ValueError(f"Unsupported direction: {direction!r}")

    notional = capital * risk_fraction

    if direction == "LONG":
        raw_return_pct = (exit_price - entry_price) / entry_price
    else:  # SHORT
        raw_return_pct = (entry_price - exit_price) / entry_price

    gross_pnl = notional * raw_return_pct
    round_trip_cost_pct = 2 * (fee_pct + slippage_pct)
    cost = notional * round_trip_cost_pct

    return gross_pnl - cost


def simulate_trade(
    final_decision: Optional[str],
    entry_price: float,
    exit_price: float,
    capital: float,
    risk_fraction: float,
    fee_pct: float,
    slippage_pct: float,
) -> float:
    """Return the trade's P&L in USD, or 0.0 if there was no trade
    (final_decision is None — the risk gate blocked it, or there was no
    DRL signal to begin with)."""
    if final_decision is None:
        return 0.0
    return compute_pnl_usd(
        final_decision, entry_price, exit_price, capital, risk_fraction, fee_pct, slippage_pct
    )
