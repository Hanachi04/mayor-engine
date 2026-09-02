# NOTE: "analyst-council" (this layer's own directory name) contains a
# hyphen, which is not a valid Python package identifier — it can never be
# part of a dotted import path (`from ..adapters import x` is impossible).
# Every layer is therefore run with its OWN folder as the sys.path root
# (main.py does this once, at process start), and internal modules
# (agents, adapters, persistence — all valid identifiers) are imported as
# plain top-level absolute imports, exactly as below.
# Switched from Ollama to Groq on 1 Sept 2026 — see adapters/groq.py
# docstring for why (Replit free-tier RAM too small for any workable local
# model). adapters/ollama.py is kept for future local re-enablement.
from adapters import groq as sentiment_provider


def sentiment_node(state: dict) -> dict:
    snapshot = state["snapshot"]
    reflection_context = state.get("reflection_context")
    try:
        result = sentiment_provider.classify(snapshot, reflection_context=reflection_context)
    except Exception as exc:
        result = {
            "label": "neutral",
            "score": 0.0,
            "reason": f"sentiment unavailable: {type(exc).__name__}: {exc}",
        }
    return {"sentiment": result}
