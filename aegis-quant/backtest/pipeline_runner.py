"""Orchestrates one (symbol, as_of) decision through all four Aegis Quant
layers — matching the documented architecture (each layer communicates only
through the shared aegis.sqlite3 database).
"""

import os
import sqlite3
import sys
from typing import Optional

REPO_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
AEGIS_ROOT = os.path.join(os.path.dirname(__file__), "..")
DB_PATH = os.path.join(AEGIS_ROOT, "data", "aegis.sqlite3")

LAYER_ENTRYPOINTS = [
    "analyst-council",
    "debate-chamber",
    "drl-sizing",
    "risk-memory",
]


def run_layer(layer_folder: str, symbol: str, as_of_iso: str, as_of_ms: Optional[int] = None, timeout: int = 60) -> None:
    for mod_name in list(sys.modules.keys()):
        if mod_name in ("adapters", "persistence", "agents", "metrics", "risk", "reflection", "graph", "main", "config", "state", "environment", "sizing", "agent", "reward") or mod_name.startswith(("adapters.", "persistence.", "agents.", "metrics.", "risk.", "reflection.", "environment.", "sizing.", "agent.", "reward.")):
            del sys.modules[mod_name]

    cwd = os.path.join(AEGIS_ROOT, layer_folder)
    sys.path.insert(0, cwd)
    try:
        if layer_folder == "analyst-council":
            import adapters.market_data as m_data
            import persistence.sqlite_store as ac_store
            import graph as ac_graph
            snapshot = m_data.load_snapshot(symbol=symbol, as_of=as_of_ms)
            graph = ac_graph.build_graph()
            state = graph.invoke({
                "symbol": symbol,
                "as_of": snapshot["close_time"],
                "snapshot": snapshot,
            })
            conn = sqlite3.connect(DB_PATH)
            try:
                state["sqlite_decision_id"] = ac_store.log_decision(conn, state)
            finally:
                conn.close()

        elif layer_folder == "debate-chamber":
            import adapters.council_input as c_input
            import persistence.sqlite_store as dc_store
            import graph as dc_graph
            conn = sqlite3.connect(DB_PATH)
            try:
                council = c_input.load_council_output(conn, symbol=symbol, as_of=as_of_ms)
                graph = dc_graph.build_graph()
                state = graph.invoke({
                    "symbol": council["symbol"],
                    "as_of": council["as_of"],
                    "snapshot": council["snapshot"],
                    "fundamentals": council["fundamentals"],
                    "sentiment": council["sentiment"],
                    "technicals": council["technicals"],
                })
                state["sqlite_decision_id"] = dc_store.log_debate(conn, state)
            finally:
                conn.close()

        elif layer_folder == "drl-sizing":
            import adapters.debate_input as d_input
            import adapters.local_market as l_market
            import persistence.sqlite_store as drl_store
            import graph as drl_graph
            conn = sqlite3.connect(DB_PATH)
            try:
                debate = d_input.load_debate_output(conn, symbol=symbol, as_of=as_of_ms)
                market_snapshot = l_market.load_market_snapshot(symbol=symbol, as_of=debate["as_of"])
                graph = drl_graph.build_graph()
                state = graph.invoke({
                    "symbol": debate["symbol"],
                    "as_of": debate["as_of"],
                    "final_decision": debate["final_decision"],
                    "final_score": debate["final_score"],
                    "decisive_side": debate["decisive_side"],
                    "market_snapshot": market_snapshot,
                })
                state.pop("market_snapshot", None)
                state.pop("execution_candidates", None)
                state["sqlite_decision_id"] = drl_store.log_result(conn, state)
            finally:
                conn.close()

        elif layer_folder == "risk-memory":
            import graph as rm_graph
            rm_graph.run_pipeline(symbol, as_of_iso)
    finally:
        if sys.path[0] == cwd:
            sys.path.pop(0)


def run_all_layers(symbol: str, as_of_iso: str, as_of_ms: Optional[int] = None) -> None:
    for layer_folder in LAYER_ENTRYPOINTS:
        run_layer(layer_folder, symbol, as_of_iso, as_of_ms=as_of_ms)


def fetch_final_decision(symbol: str, as_of: str, db_path: str) -> Optional[dict]:
    """Read back the risk-memory layer's verdict for this (symbol, as_of)
    directly from the shared database."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            """
            SELECT final_decision, drl_direction, risk_gate_passed, risk_gate_reason
            FROM risk_memory_events
            WHERE symbol = ? AND as_of = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (symbol, as_of),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def fetch_drl_risk_fraction(symbol: str, as_of: str, db_path: str) -> Optional[float]:
    """Read the DRL layer's chosen risk_fraction for this (symbol, as_of)."""
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='drl_sizing_decisions'"
        )
        if cursor.fetchone() is None:
            return None
        cols = {col[1] for col in conn.execute("PRAGMA table_info(drl_sizing_decisions)")}
        if "selected_risk_pct" in cols:
            row = conn.execute(
                "SELECT selected_risk_pct FROM drl_sizing_decisions WHERE symbol = ? AND (as_of = ? OR as_of = ? - 3599999) ORDER BY id DESC LIMIT 1",
                (symbol, as_of, as_of),
            ).fetchone()
            if row and row[0] is not None:
                return row[0]
        if "risk_fraction" in cols:
            row = conn.execute(
                "SELECT risk_fraction FROM drl_sizing_decisions WHERE symbol = ? AND (as_of = ? OR as_of = ? - 3599999) ORDER BY id DESC LIMIT 1",
                (symbol, as_of, as_of),
            ).fetchone()
            if row and row[0] is not None:
                return row[0]
        return None
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()
