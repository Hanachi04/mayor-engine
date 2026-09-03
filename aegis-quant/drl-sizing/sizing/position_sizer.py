"""
Converts a chosen risk fraction into a concrete position size. Never returns
a negative size or exceeds config.MAX_RISK_PCT — those are protective
bounds enforced here, not merely suggested.
"""
import config


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def stop_distance_pct(volatility: float) -> float:
    return clamp(
        config.VOLATILITY_MULTIPLIER * volatility,
        config.MIN_STOP_DISTANCE_PCT,
        config.MAX_STOP_DISTANCE_PCT,
    )


def size_from_action(risk_fraction: float, equity: float, entry_price: float,
                      stop_distance: float) -> dict:
    risk_pct = clamp(risk_fraction, config.MIN_RISK_PCT, config.MAX_RISK_PCT)
    risk_amount = equity * risk_pct
    if stop_distance <= 0 or entry_price <= 0:
        return {"risk_pct": risk_pct, "risk_amount": risk_amount, "notional": 0.0, "quantity": 0.0}
    notional = risk_amount / stop_distance
    quantity = notional / entry_price
    return {
        "risk_pct": risk_pct,
        "risk_amount": risk_amount,
        "notional": notional,
        "quantity": quantity,
    }
