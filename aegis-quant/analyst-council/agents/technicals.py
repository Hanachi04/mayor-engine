"""
Technicals agent. Builds its view directly from the raw indicators
(RSI, MACD vs signal, close vs Bollinger mid) rather than any pre-summarized
data from market_data. Receives the full snapshot and computes its own signals.

View: {rsi_signal, macd_signal, bollinger_signal}
where each signal is one of: "bullish", "bearish", "neutral".

Logic:
  - RSI: < 30 = oversold (bullish), > 70 = overbought (bearish), else neutral.
  - MACD: macd > signal = bullish, macd < signal = bearish, else neutral.
  - Bollinger: close > bb_upper = overbought (bearish), close < bb_lower = oversold (bullish),
              else neutral.

Each signal is independent; no voting or aggregation happens at this layer.
The council layer (graph.py) handles aggregation via LangGraph.
"""


def technicals_node(state: dict) -> dict:
    """Build technicals view from snapshot."""
    snapshot = state["snapshot"]
    
    required_fields = ["rsi", "macd", "macd_signal", "close", "bb_lower", "bb_mid", "bb_upper"]
    missing = [f for f in required_fields if f not in snapshot]
    if missing:
        raise ValueError(f"snapshot missing required fields: {missing}")
    
    rsi = snapshot["rsi"]
    macd = snapshot["macd"]
    macd_signal = snapshot["macd_signal"]
    close = snapshot["close"]
    bb_lower = snapshot["bb_lower"]
    bb_upper = snapshot["bb_upper"]
    
    # RSI signal.
    if rsi < 30:
        rsi_signal = "bullish"
    elif rsi > 70:
        rsi_signal = "bearish"
    else:
        rsi_signal = "neutral"
    
    # MACD signal.
    if macd > macd_signal:
        macd_signal_val = "bullish"
    elif macd < macd_signal:
        macd_signal_val = "bearish"
    else:
        macd_signal_val = "neutral"
    
    # Bollinger signal.
    if close > bb_upper:
        bollinger_signal = "bearish"
    elif close < bb_lower:
        bollinger_signal = "bullish"
    else:
        bollinger_signal = "neutral"
    
    return {
        "technicals": {
            "rsi_signal": rsi_signal,
            "macd_signal": macd_signal_val,
            "bollinger_signal": bollinger_signal,
        }
    }
