import json
import sqlite3
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS drl_sizing_decisions (
    id INTEGER PRIMARY KEY,
    symbol TEXT NOT NULL,
    as_of INTEGER NOT NULL,
    final_decision TEXT,
    final_score REAL,
    execution_status TEXT NOT NULL,
    rejection_reason TEXT,
    selected_risk_pct REAL,
    selected_notional REAL,
    selected_timing_offset_ms INTEGER,
    expected_slippage_bps REAL,
    expected_return_pct REAL,
    reward REAL,
    simulation_summary_json TEXT,
    created_at TEXT NOT NULL
);
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(SCHEMA)
    conn.commit()


def log_result(conn: sqlite3.Connection, state: dict) -> int:
    ensure_schema(conn)
    cur = conn.execute(
        """
        INSERT INTO drl_sizing_decisions
            (symbol, as_of, final_decision, final_score, execution_status, rejection_reason,
             selected_risk_pct, selected_notional, selected_timing_offset_ms,
             expected_slippage_bps, expected_return_pct, reward, simulation_summary_json,
             created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            state["symbol"],
            state["as_of"],
            state.get("final_decision"),
            state.get("final_score"),
            state["execution_status"],
            state.get("rejection_reason"),
            state.get("selected_risk_pct"),
            state.get("selected_notional"),
            state.get("selected_timing_offset_ms"),
            state.get("expected_slippage_bps"),
            state.get("expected_return_pct"),
            state.get("reward"),
            json.dumps(state.get("simulation_summary")) if state.get("simulation_summary") else None,
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    conn.commit()
    return cur.lastrowid
