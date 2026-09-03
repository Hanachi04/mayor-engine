"""
Bear agent. Mirror of agents/bull.py: builds the strongest bearish case
directly from raw indicators, records opposing (bullish) evidence honestly
in "risks". See bull.py's module docstring for why this decomposes raw
indicators instead of reading technicals["view"].
"""


def bear_node(state: dict) -> dict:
    indicators = state["technicals"]["indicators"]
    rsi = indicators["rsi"]
    macd = indicators["macd"]
    macd_signal = indicators["macd_signal"]
    bb_mid = indicators["bb_mid"]
    close = state["snapshot"]["close"]
    sentiment = state["sentiment"]
    fundamentals = state["fundamentals"]

    arguments = []
    risks = []
    bullish_votes = 0
    bearish_votes = 0

    if rsi > 70:
        arguments.append(f"RSI={rsi:.2f} overbought (>70): supports a bearish reversal case")
        bearish_votes += 1
    elif rsi < 30:
        risks.append(f"RSI={rsi:.2f} oversold (<30): opposes the bearish case")
        bullish_votes += 1

    if macd < macd_signal:
        arguments.append("MACD below signal: negative momentum supports the bearish case")
        bearish_votes += 1
    elif macd > macd_signal:
        risks.append("MACD above signal: momentum does not support the bearish case")
        bullish_votes += 1

    if close < bb_mid:
        arguments.append("close below Bollinger midpoint: price is below the middle band")
        bearish_votes += 1
    elif close > bb_mid:
        risks.append("close above Bollinger midpoint: price is not below the middle band")
        bullish_votes += 1

    if sentiment["label"] == "bearish":
        arguments.append("Sentiment agent is bearish")
        bearish_votes += 1
    elif sentiment["label"] == "bullish":
        risks.append("Sentiment agent is bullish")
        bullish_votes += 1

    if fundamentals["market_cap"] is None:
        risks.append("market cap is unavailable locally")

    total = bullish_votes + bearish_votes
    # Net signed score in [-1, 1] — see bull.py for why (consistency with
    # sentiment/technicals scoring; opposing evidence must pull the score
    # toward zero/negative, not just be ignored).
    score = 0.0 if total == 0 else (bearish_votes - bullish_votes) / total
    view = "bearish" if bearish_votes > bullish_votes else (
        "bullish" if bullish_votes > bearish_votes else "neutral"
    )

    return {
        "bear_case": {
            "side": "BEAR",
            "view": view,
            "score": score,
            "evidence": {
                "fundamentals": fundamentals,
                "sentiment": sentiment,
                "technicals": state["technicals"],
            },
            "arguments": arguments,
            "risks": risks,
        }
    }
