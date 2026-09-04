"""SQLite persistence for the Risk Gate + Memory + Reflection layer.

All Aegis Quant layers share one SQLite file and communicate exclusively
through it (never by importing each other's modules) — see
config.DB_PATH. This module owns the three tables specific to Layer 4
and provides small, defensive helpers used by the adapters and nodes.
"""

import sqlite3
from contextlib import contextmanager

from config import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS risk_memory_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    as_of TEXT NOT NULL,
    drl_direction TEXT,
    drl_reward REAL,
    drawdown_pct REAL,
    cumulative_sharpe REAL,
    risk_gate_passed INTEGER,
    risk_gate_reason TEXT,
    final_decision TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS risk_metric_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    as_of TEXT NOT NULL,
    drawdown_pct REAL,
    cumulative_sharpe REAL,
    observation_count INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reflection_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    as_of TEXT NOT NULL,
    pattern TEXT NOT NULL,
    reflection_context TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
"""


@contextmanager
def get_connection(db_path: str = DB_PATH):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db(db_path: str = DB_PATH) -> None:
    with get_connection(db_path) as conn:
        conn.executescript(_SCHEMA)


def insert_risk_memory_event(conn, event: dict) -> None:
    conn.execute(
        """
        INSERT INTO risk_memory_events
            (symbol, as_of, drl_direction, drl_reward, drawdown_pct,
             cumulative_sharpe, risk_gate_passed, risk_gate_reason, final_decision)
        VALUES (:symbol, :as_of, :drl_direction, :drl_reward, :drawdown_pct,
                :cumulative_sharpe, :risk_gate_passed, :risk_gate_reason, :final_decision)
        """,
        event,
    )


def insert_risk_metric_snapshot(conn, snapshot: dict) -> None:
    conn.execute(
        """
        INSERT INTO risk_metric_snapshots
            (symbol, as_of, drawdown_pct, cumulative_sharpe, observation_count)
        VALUES (:symbol, :as_of, :drawdown_pct, :cumulative_sharpe, :observation_count)
        """,
        snapshot,
    )


def insert_reflection_memory(conn, symbol: str, as_of: str, pattern: str, reflection_context: str) -> None:
    conn.execute(
        """
        INSERT INTO reflection_memory (symbol, as_of, pattern, reflection_context)
        VALUES (?, ?, ?, ?)
        """,
        (symbol, as_of, pattern, reflection_context),
    )


def fetch_recent_risk_memory_events(conn, symbol: str, limit: int = 10):
    rows = conn.execute(
        """
        SELECT * FROM risk_memory_events
        WHERE symbol = ?
        ORDER BY id DESC
        LIMIT ?
        """,
        (symbol, limit),
    ).fetchall()
    return [dict(r) for r in rows]
