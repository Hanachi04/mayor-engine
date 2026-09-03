"""
Honest naming note: this project's original design called this the "DRL
agent", but what is actually implemented (here and in the original design
sketch it came from) is a bounded grid search over (risk_fraction,
timing_offset_ms) candidates, scored by reward/function.py, not a trained
reinforcement-learning policy. There is no training loop and no learned
weights. agent/train.py exists as a documented placeholder for future real
RL training; agent/infer.py performs the grid search described above.
This is a naming/scope note, not a hidden change — flagged explicitly so
nobody mistakes "DRL Sizing" for an actually-trained model.
"""
import config
from adapters import local_market
from sizing import position_sizer


def simulate_candidate(direction: str, market_snapshot: dict,
                        risk_fraction: float, timing_offset_ms: int) -> dict:
    execution_candle = local_market.candle_for_offset(market_snapshot, timing_offset_ms)
    if execution_candle is None:
        return {"invalid_action": True, "reason": "execution candle beyond available data"}

    exit_candle = local_market.next_candle_after(market_snapshot, execution_candle)
    if exit_candle is None:
        return {"invalid_action": True, "reason": "no next candle available for exit"}

    entry_price = execution_candle["close"]
    exit_price = exit_candle["close"]

    if direction == "LONG":
        gross_return_pct = (exit_price - entry_price) / entry_price * 100.0
        adverse_pct = max(0.0, (entry_price - exit_candle["low"]) / entry_price * 100.0)
    elif direction == "SHORT":
        gross_return_pct = (entry_price - exit_price) / entry_price * 100.0
        adverse_pct = max(0.0, (exit_candle["high"] - entry_price) / entry_price * 100.0)
    else:
        return {"invalid_action": True, "reason": f"invalid direction {direction!r}"}

    wait_fraction = timing_offset_ms / max(config.TIMING_OFFSETS_MS)
    slippage_bps = config.MAX_SLIPPAGE_BPS * max(0.0, 1.0 - wait_fraction)
    timing_penalty_pct = config.TIMING_PENALTY_MAX_PCT * wait_fraction

    stop_distance = position_sizer.stop_distance_pct(market_snapshot["volatility"])
    sizing = position_sizer.size_from_action(
        risk_fraction, config.EQUITY_USD, entry_price, stop_distance
    )
    violates_risk_limit = risk_fraction > config.MAX_RISK_PCT

    return {
        "invalid_action": False,
        "violates_risk_limit": violates_risk_limit,
        "gross_return_pct": gross_return_pct,
        "slippage_bps": slippage_bps,
        "fee_bps": config.FEE_BPS,
        "drawdown_pct": adverse_pct,
        "timing_penalty_pct": timing_penalty_pct,
        "risk_fraction": risk_fraction,
        "timing_offset_ms": timing_offset_ms,
        "entry_price": entry_price,
        "exit_price": exit_price,
        "sizing": sizing,
    }
