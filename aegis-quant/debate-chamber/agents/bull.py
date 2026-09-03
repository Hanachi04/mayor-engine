"""
Bull agent. Builds the strongest bullish case directly from raw indicators
(RSI, MACD vs signal, close vs Bollinger mid) — NOT from a pre-summarized
"view" field. This mirrors the exact fix required for this layer in the
original build: bear/bull agents that only read technicals["view"] produced
a single weak argument ("market cap unavailable") instead of a real
indicator-based case. Both agents here decompose the indicators from the
very first version.

Each side is required to record opposing evidence honestly (in "risks"),
never omit it — a one-sided case is not a real debate.
"""


def bull_node(state: dict) -> dict:
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

    if rsi < 30:
        arguments.append(f"RSI={rsi:.2f} oversold (<30): supports a bullish reversal case")
        bullish_votes += 1
    elif rsi > 70:
        risks.append(f"RSI={rsi:.2f} overbought (>70): opposes the bullish case")
        bearish_votes += 1

    if macd > macd_signal:
        arguments.append("MACD above signal: positive momentum supports the bullish case")
        bullish_votes += 1
    elif macd < macd_signal:
        risks.append("MACD below signal: momentum does not support the bullish case")
        bearish_votes += 1

    if close > bb_mid:
        arguments.append("close above Bollinger midpoint: price is above the middle band")
        bullish_votes += 1
    elif close < bb_mid:
        risks.append("close below Bollinger midpoint: price is not above the middle band")
        bearish_votes += 1

    if sentiment["label"] == "bullish":
        arguments.append("Sentiment agent is bullish")
        bullish_votes += 1
    elif sentiment["label"] == "bearish":
        risks.append("Sentiment agent is bearish")
        bearish_votes += 1

    if fundamentals["market_cap"] is None:
        risks.append("market cap is unavailable locally")

    total = bullish_votes + bearish_votes
    # Net signed score in [-1, 1], consistent with sentiment/technicals
    # scoring elsewhere in the system: opposing evidence actively pulls the
    # score down, it does not just get ignored. A bull case surrounded by
    # more bearish evidence than bullish MUST show a negative score, even
    # though it is still labeled "BULL" side.
    score = 0.0 if total == 0 else (bullish_votes - bearish_votes) / total
    view = "bullish" if bullish_votes > bearish_votes else (
        "bearish" if bearish_votes > bullish_votes else "neutral"
    )

    return {
        "bull_case": {
            "side": "BULL",
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
