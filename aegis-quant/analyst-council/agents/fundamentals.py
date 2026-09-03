"""
Fundamentals agent. No external API call — reads volume/market_cap from the
local snapshot only. Never fabricates a value for missing fields (market_cap
is not available from local OHLCV data by design).
"""


def fundamentals_node(state: dict) -> dict:
    snapshot = state["snapshot"]
    volume = snapshot.get("volume")
    market_cap = snapshot.get("market_cap")

    if market_cap is None:
        view = "neutral"
        score = 0.0
        reason = "market cap is unavailable locally; no fundamentals signal generated"
    else:
        view = "neutral"
        score = 0.0
        reason = "fundamentals signal not yet implemented beyond availability check"

    return {
        "fundamentals": {
            "volume": volume,
            "market_cap": market_cap,
            "view": view,
            "score": score,
            "reason": reason,
        }
    }
