"""
Reads Analyst Council (Layer 1) output. Read-only — never recomputes any
indicator or calls Ollama/Groq directly from this layer.

IMPORTANT: this does NOT import analyst-council's persistence/sqlite_store.py
module. Every layer runs with its own directory as the sys.path root (see
analyst-council/agents/sentiment.py for why — hyphenated directory names
can't be dotted-imported), which means a bare `from persistence import
sqlite_store` here could silently resolve to *this layer's own*
persistence/sqlite_store.py (a different module, different schema:
debate_chamber_decisions, not analyst_council_decisions) if both layers'
roots ever end up on sys.path at once in the same process — a real
cross-layer name collision, not a hypothetical one. To avoid it entirely,
this adapter queries the `analyst_council_decisions` table directly with
plain SQL instead of importing the other layer's Python module.
"""
import json
import sqlite3


def load_council_output(conn: sqlite3.Connection, symbol: str = "BTCUSDT",
                          as_of: int | None = None) -> dict:
    if as_of is None:
        row = conn.execute(
            """
            SELECT symbol, as_of, snapshot_json, fundamentals_json, sentiment_json, technicals_json
            FROM analyst_council_decisions
            WHERE symbol = ?
            ORDER BY id DESC LIMIT 1
            """,
            (symbol,),
        ).fetchone()
    else:
        row = conn.execute(
            """
            SELECT symbol, as_of, snapshot_json, fundamentals_json, sentiment_json, technicals_json
            FROM analyst_council_decisions
            WHERE symbol = ? AND as_of = ?
            """,
            (symbol, as_of),
        ).fetchone()

    if row is None:
        raise ValueError(f"No analyst council decision found for {symbol} as_of={as_of}")

    symbol_out, as_of_out, snapshot_json, fundamentals_json, sentiment_json, technicals_json = row
    if snapshot_json is None:
        raise ValueError(
            f"analyst_council_decisions row for {symbol} as_of={as_of_out} has no "
            "snapshot_json (row predates the schema migration) — cannot run the "
            "debate chamber on it."
        )
    return {
        "symbol": symbol_out,
        "as_of": as_of_out,
        "snapshot": json.loads(snapshot_json),
        "fundamentals": json.loads(fundamentals_json),
        "sentiment": json.loads(sentiment_json),
        "technicals": json.loads(technicals_json),
    }
