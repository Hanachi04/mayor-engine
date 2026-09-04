"""Reads the latest DRL sizing decision from the shared SQLite database.

Layer 4 never imports Layer 3's Python package directly (folder names use
hyphens and each layer runs as an isolated subprocess in CI). Instead it
reads Layer 3's output row via plain SQL, defensively, so a column that
doesn't exist yet on a given deployment doesn't crash the whole layer.
"""

import sqlite3
from typing import Optional

from config import DB_PATH


def fetch_latest_drl_decision(symbol: str, as_of: str, db_path: str = DB_PATH) -> Optional[dict]:
    """Return the most recent drl_sizing_decisions row for `symbol` at/before `as_of`.

    Returns None if the table doesn't exist yet (Layer 3 never ran) or no
    matching row is found — callers must treat that as "no signal" rather
    than raising, since the layers are independently deployable.
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            """
            SELECT name FROM sqlite_master
            WHERE type='table' AND name='drl_sizing_decisions'
            """
        )
        if cursor.fetchone() is None:
            return None

        row = conn.execute(
            """
            SELECT * FROM drl_sizing_decisions
            WHERE symbol = ? AND as_of <= ?
            ORDER BY as_of DESC
            LIMIT 1
            """,
            (symbol, as_of),
        ).fetchone()

        if row is None:
            return None

        result = dict(row)
        return {
            "drl_direction": result.get("direction"),
            "drl_risk_fraction": result.get("risk_fraction"),
            "drl_timing_offset": result.get("timing_offset"),
            "drl_reward": result.get("reward"),
        }
    finally:
        conn.close()
