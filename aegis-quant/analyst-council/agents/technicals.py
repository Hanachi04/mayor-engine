"""
Technicals agent. Builds its view directly from the raw indicators
(RSI, MACD vs signal, close vs Bollinger mid) rather than any pre-summarized
field — this mirrors the fix later required in the debate-chamber layer
(bull/bear agents were found to rely on a lazy "view" summary instead of
the indicators themselves; this agent avoids that mistake from the start).
"""


def technicals_node(state: dict) -> dict:
    snapshot = state["snapshot"]
    rsi = snapshot["rsi"]
    macd = snapshot["macd"]
    macd_signal = snapshot["macd_signal"]
    close = snapshot["close"]
    bb_mid = snapshot["bb_mid"]

    bullish_votes = 0
    bearish_votes = 0
    reasons = []

    if rsi > 70:
        bearish_votes += 1
        reasons.append(f"RSI={rsi:.2f} overbought (>70)")
    elif rsi < 30:
        bullish_votes += 1
        reasons.append(f"RSI={rsi:.2f} oversold (<30)")

    if macd > macd_signal:
        bullish_votes += 1
        reasons.append("MACD above signal: positive momentum")
    elif macd < macd_signal:
        bearish_votes += 1
        reasons.append("MACD below signal: negative momentum")

    if close > bb_mid:
        bullish_votes += 1
        reasons.append("close above Bollinger midpoint")
    elif close < bb_mid:
        bearish_votes += 1
        reasons.append("close below Bollinger midpoint")

    if bullish_votes > bearish_votes:
        view = "bullish"
    elif bearish_votes > bullish_votes:
        view = "bearish"
    else:
        view = "neutral"

    total_votes = bullish_votes + bearish_votes
    score = 0.0 if total_votes == 0 else (bullish_votes - bearish_votes) / total_votes

    return {
        "technicals": {
            "view": view,
            "score": score,
            "reason": "; ".join(reasons) if reasons else "no signal from available indicators",
            "indicators": {
                "rsi": rsi,
                "macd": macd,
                "macd_signal": macd_signal,
                "bb_mid": bb_mid,
                "bb_upper": snapshot["bb_upper"],
                "bb_lower": snapshot["bb_lower"],
                "volatility": snapshot["volatility"],
            },
        }
    }
