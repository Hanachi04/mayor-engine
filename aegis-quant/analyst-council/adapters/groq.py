"""
Groq adapter for the sentiment agent.

Replaces the local Ollama adapter (adapters/ollama.py) as of 1 Sept 2026:
Ollama's smallest workable local model (qwen2.5:3b, 2.1GiB) does not fit in
Replit's free-tier RAM (1.5GiB total, ~293MiB free at test time). This is an
explicit, deliberate departure from the original "offline-first, no external
API" design principle (Layer 5 of the original plan) — a resource-driven
tradeoff, not a design oversight. adapters/ollama.py is kept in the repo for
reference / future local re-enablement on a machine with enough RAM.

Same interface as ollama.classify(): same technical-fields-only prompt
(no market_cap/volume leakage — verified by the same test that guarded the
Ollama version), same JSON output contract, so agents/sentiment.py only
needs a one-line import change to switch providers.

Model: openai/gpt-oss-120b (Groq's replacement for the decommissioned
llama-3.3-70b-versatile, chosen earlier in this project for the same task).
Verify this model id is still valid in the Groq console before relying on it —
Groq's available-model list has changed at least once already in this project.
"""
import json
import os
import urllib.request

GROQ_ENDPOINT = "https://api.groq.com/openai/v1"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")

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
    a fake HTTP layer in tests without a real Groq API key. Production code
    path (transport=None) calls the real Groq chat/completions endpoint and
    requires GROQ_API_KEY to be set in the environment.
    """
    messages = _build_messages(snapshot, reflection_context)

    if transport is not None:
        raw_text = transport(messages)
    else:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY environment variable is not set")
        payload = json.dumps({
            "model": GROQ_MODEL,
            "messages": messages,
            "temperature": 0.0,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "sentiment",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string", "enum": ["bullish", "bearish", "neutral"]},
                            "score": {"type": "number"},
                            "reason": {"type": "string"},
                        },
                        "required": ["label", "score", "reason"],
                        "additionalProperties": False,
                    },
                },
            },
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{GROQ_ENDPOINT}/chat/completions",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
                # Cloudflare (in front of Groq's API) blocks the default
                # Python urllib User-Agent ("Python-urllib/3.x") as a bot
                # signature (error code 1010) — confirmed 1 Sept 2026: the
                # exact same request succeeded via curl (HTTP 200) and
                # failed via bare urllib (HTTP 403) with no other
                # difference. This header is the fix, not a logic change.
                "User-Agent": "aegis-quant-analyst-council/1.0",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        raw_text = body["choices"][0]["message"]["content"]

    result = json.loads(raw_text)
    result["score"] = max(-1.0, min(1.0, float(result["score"])))
    if result["label"] not in {"bullish", "bearish", "neutral"}:
        raise ValueError(f"invalid sentiment label: {result['label']!r}")
    return result
