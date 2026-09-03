import json
import sqlite3
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS analyst_council_decisions (
    id INTEGER PRIMARY KEY,
    symbol TEXT NOT NULL,
    as_of INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    fundamentals_json TEXT NOT NULL,
    sentiment_json TEXT NOT NULL,
    technicals_json TEXT NOT NULL,
    council_decision TEXT,
    risk_pct REAL,
    created_at TEXT NOT NULL
);
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(SCHEMA)
    # Backward-compatible migration: earlier committed rows (this project's
    # very first Layer-1 test rows) predate snapshot_json. Add the column if
    # an older table already exists without it, instead of assuming a clean
    # database.
    existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(analyst_council_decisions)")}
    if "snapshot_json" not in existing_cols:
        conn.execute("ALTER TABLE analyst_council_decisions ADD COLUMN snapshot_json TEXT")
    conn.commit()


def log_decision(conn: sqlite3.Connection, state: dict) -> int:
    ensure_schema(conn)
    cur = conn.execute(
        """
        INSERT INTO analyst_council_decisions
            (symbol, as_of, snapshot_json, fundamentals_json, sentiment_json, technicals_json,
             council_decision, risk_pct, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            state["symbol"],
            state["as_of"],
            json.dumps(state["snapshot"]),
            json.dumps(state["fundamentals"]),
            json.dumps(state["sentiment"]),
            json.dumps(state["technicals"]),
            state.get("council_decision"),
            state.get("risk_pct"),
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    conn.commit()
    return cur.lastrowid


def load_latest(conn: sqlite3.Connection, symbol: str) -> dict | None:
    ensure_schema(conn)
    row = conn.execute(
        """
        SELECT symbol, as_of, snapshot_json, fundamentals_json, sentiment_json, technicals_json,
               council_decision, risk_pct
        FROM analyst_council_decisions
        WHERE symbol = ?
        ORDER BY id DESC LIMIT 1
        """,
        (symbol,),
    ).fetchone()
    if row is None:
        return None
    return _row_to_dict(row)


def load_by_as_of(conn: sqlite3.Connection, symbol: str, as_of: int) -> dict | None:
    ensure_schema(conn)
    row = conn.execute(
        """
        SELECT symbol, as_of, snapshot_json, fundamentals_json, sentiment_json, technicals_json,
               council_decision, risk_pct
        FROM analyst_council_decisions
        WHERE symbol = ? AND as_of = ?
        """,
        (symbol, as_of),
    ).fetchone()
    if row is None:
        return None
    return _row_to_dict(row)


def _row_to_dict(row) -> dict:
    symbol, as_of, snapshot_json, fundamentals_json, sentiment_json, technicals_json, decision, risk_pct = row
    return {
        "symbol": symbol,
        "as_of": as_of,
        "snapshot": json.loads(snapshot_json) if snapshot_json else None,
        "fundamentals": json.loads(fundamentals_json),
        "sentiment": json.loads(sentiment_json),
        "technicals": json.loads(technicals_json),
        "council_decision": decision,
        "risk_pct": risk_pct,
    }
