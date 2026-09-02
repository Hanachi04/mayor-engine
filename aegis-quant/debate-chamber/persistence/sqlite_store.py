import json
import sqlite3
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS debate_chamber_decisions (
    id INTEGER PRIMARY KEY,
    symbol TEXT NOT NULL,
    as_of INTEGER NOT NULL,
    bull_case_json TEXT NOT NULL,
    bear_case_json TEXT NOT NULL,
    final_decision TEXT,
    final_score REAL NOT NULL,
    decisive_side TEXT,
    risk_pct REAL NOT NULL,
    created_at TEXT NOT NULL
);
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(SCHEMA)
    conn.commit()


def log_debate(conn: sqlite3.Connection, state: dict) -> int:
    ensure_schema(conn)
    cur = conn.execute(
        """
        INSERT INTO debate_chamber_decisions
            (symbol, as_of, bull_case_json, bear_case_json, final_decision,
             final_score, decisive_side, risk_pct, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            state["symbol"],
            state["as_of"],
            json.dumps(state["bull_case"]),
            json.dumps(state["bear_case"]),
            state.get("final_decision"),
            state["final_score"],
            state.get("decisive_side"),
            state["risk_pct"],
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    conn.commit()
    return cur.lastrowid
