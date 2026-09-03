"""
Reads Debate Chamber (Layer 2) output. Read-only.

Same cross-layer-import-collision reasoning as
debate-chamber/adapters/council_input.py: this queries the
`debate_chamber_decisions` table directly with plain SQL instead of
importing debate-chamber's own persistence/sqlite_store.py module — every
layer's own "persistence" package would otherwise shadow the others when
multiple layer roots are on sys.path in the same process (confirmed as a
real, reproducible bug while building Layer 2, not a theoretical concern).
"""
import json
import sqlite3


def load_debate_output(conn: sqlite3.Connection, symbol: str = "BTCUSDT",
                         as_of: int | None = None) -> dict:
    if as_of is None:
        row = conn.execute(
            """
            SELECT symbol, as_of, final_decision, final_score, decisive_side
            FROM debate_chamber_decisions
            WHERE symbol = ?
            ORDER BY id DESC LIMIT 1
            """,
            (symbol,),
        ).fetchone()
    else:
        row = conn.execute(
            """
            SELECT symbol, as_of, final_decision, final_score, decisive_side
            FROM debate_chamber_decisions
            WHERE symbol = ? AND as_of = ?
            """,
            (symbol, as_of),
        ).fetchone()

    if row is None:
        raise ValueError(f"No debate chamber decision found for {symbol} as_of={as_of}")

    symbol_out, as_of_out, final_decision, final_score, decisive_side = row
    return {
        "symbol": symbol_out,
        "as_of": as_of_out,
        "final_decision": final_decision,
        "final_score": final_score,
        "decisive_side": decisive_side,
    }
