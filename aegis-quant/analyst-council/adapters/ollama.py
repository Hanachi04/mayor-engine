"""
Ollama adapter for the sentiment agent.

Design decisions locked in during the original build (kept here verbatim):
  - Model default: qwen2.5:3b (2.1GiB, quantized). Load from local ollama server.
  - Prompt: technical indicators only (RSI, MACD, Bollinger Bands, volatility).
  - No market_cap/volume/fundamentals leakage — verify by test_sentiment_no_leakage.
  - JSON output: {label: "bullish"|"bearish"|"neutral", score: float(-1..1), reason: str}.

WARNING: Ollama's smallest usable local model (qwen2.5:3b, 2.1GiB) does NOT fit
in Replit's free-tier RAM (1.5GiB total, ~293MiB free). This adapter is kept
for reference and future local re-enablement on a machine with enough RAM.
As of 1 Sept 2026, the sentiment agent has switched to adapters/groq.py for
cloud-based classification. See adapters/groq.py for the reason and transition.

Same interface as groq.classify() — agents/sentiment.py can switch providers
by changing one import line.
"""
import json
import urllib.request

OLLAMA_ENDPOINT = "http://localhost:11434"
OLLAMA_MODEL = "qwen2.5:3b"

_SYSTEM_PROMPT = (
    "You are a technical sentiment classifier. Base your judgment ONLY on "
    "price action and momentum indicators provided (RSI, MACD, Bollinger "
    "Bands, volatility). Do not reference market cap, fundamentals, or any "
    "data not provided. Return JSON only with exactly: label (bullish, "
    "bearish, or neutral), score (-1 to 1), and reason."
)

_TECHNICAL_FIELDS = (
    "symbol", "close", "open", "high", "low",
    "rsi", "macd", "macd_signal", "bb_lower", "bb_mid", "bb_upper",
    "volatility",
)


def _build_messages(snapshot: dict, reflection_context: str | None) -> list[dict]:
    technical_snapshot = {k: snapshot[k] for k in _TECHNICAL_FIELDS if k in snapshot}
    user_parts = []
    if reflection_context:
        user_parts.append(
            "Prior execution reflection is advisory context only; do not "
            "override the current indicators:\n" + reflection_context
        )
    user_parts.append("Snapshot: " + json.dumps(technical_snapshot, sort_keys=True))
    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": "\n\n".join(user_parts)},
    ]


def classify(snapshot: dict, reflection_context: str | None = None,
             transport=None) -> dict:
    """
    transport: optional callable(messages: list[dict]) -> str, used to inject
    a fake HTTP layer in tests without a real Ollama server. Production code
    path (transport=None) calls the real Ollama /api/chat endpoint.
    """
    messages = _build_messages(snapshot, reflection_context)

    if transport is not None:
        raw_text = transport(messages)
    else:
        payload = json.dumps({
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "format": "json",
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{OLLAMA_ENDPOINT}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        raw_text = body["message"]["content"]

    result = json.loads(raw_text)
    result["score"] = max(-1.0, min(1.0, float(result["score"])))
    if result["label"] not in {"bullish", "bearish", "neutral"}:
        raise ValueError(f"invalid sentiment label: {result['label']!r}")
    return result
