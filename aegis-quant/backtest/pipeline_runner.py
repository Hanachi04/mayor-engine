"""Orchestrates one (symbol, as_of) decision through all four Aegis Quant
layers — matching the documented architecture (each layer communicates only
through the shared aegis.sqlite3 database).
"""

import os
import sqlite3
import sys
from typing import Optional

REPO_ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
AEGIS_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.environ.get("AEGIS_DB_PATH", os.path.join(AEGIS_ROOT, "data", "aegis.sqlite3"))

LAYER_ENTRYPOINTS = [
    "analyst-council",
    "debate-chamber",
    "drl-sizing",
    "risk-memory",
]

_LAYER_CACHE = {}


def clear_layer_modules():
    keys_to_del = [
        k
        for k in sys.modules.keys()
        if k
        in (
            "adapters",
            "persistence",
            "agents",
            "metrics",
            "risk",
            "reflection",
            "graph",
            "main",
            "config",
            "state",
            "environment",
            "sizing",
            "agent",
            "reward",
        )
        or k.startswith(
            (
                "adapters.",
                "persistence.",
                "agents.",
                "metrics.",
                "risk.",
                "reflection.",
                "environment.",
                "sizing.",
                "agent.",
                "reward.",
            )
        )
    ]
    for k in keys_to_del:
        del sys.modules[k]


def _init_layer_cache():
    if _LAYER_CACHE:
        return

    for layer_folder in LAYER_ENTRYPOINTS:
        clear_layer_modules()
        cwd = os.path.abspath(os.path.join(AEGIS_ROOT, layer_folder))
        sys.path.insert(0, cwd)

        before = dict(sys.modules)

        if layer_folder == "analyst-council":
            import adapters.market_data as m_data
            import graph as ac_graph
            import persistence.sqlite_store as ac_store

            graph = ac_graph.build_graph()
            funcs = {"m_data": m_data, "ac_store": ac_store, "graph": graph}
        elif layer_folder == "debate-chamber":
            import adapters.council_input as c_input
            import graph as dc_graph
            import persistence.sqlite_store as dc_store

            graph = dc_graph.build_graph()
            funcs = {"c_input": c_input, "dc_store": dc_store, "graph": graph}
        elif layer_folder == "drl-sizing":
            import adapters.debate_input as d_input
            import adapters.local_market as l_market
            import graph as drl_graph
            import persistence.sqlite_store as drl_store

            graph = drl_graph.build_graph()
            funcs = {
                "d_input": d_input,
                "l_market": l_market,
                "drl_store": drl_store,
                "graph": graph,
            }
        elif layer_folder == "risk-memory":
            import graph as rm_graph

            funcs = {"rm_graph": rm_graph}

        added = {k: v for k, v in sys.modules.items() if k not in before}
        _LAYER_CACHE[layer_folder] = {"added": added, "funcs": funcs, "cwd": cwd}
        sys.path.pop(0)


def run_layer(
    layer_folder: str,
    symbol: str,
    as_of_iso: str,
    as_of_ms: Optional[int] = None,
    timeout: int = 60,
) -> None:
    _init_layer_cache()
    clear_layer_modules()
    cache = _LAYER_CACHE[layer_folder]
    sys.modules.update(cache["added"])
    funcs = cache["funcs"]

    sys.path.insert(0, cache["cwd"])
    try:
        if layer_folder == "analyst-council":
            snapshot = funcs["m_data"].load_snapshot(symbol=symbol, as_of=as_of_ms)
            state = funcs["graph"].invoke(
                {
                    "symbol": symbol,
                    "as_of": snapshot["close_time"],
                    "snapshot": snapshot,
                }
            )
            conn = sqlite3.connect(DB_PATH)
            try:
                state["sqlite_decision_id"] = funcs["ac_store"].log_decision(conn, state)
            finally:
                conn.close()

        elif layer_folder == "debate-chamber":
            conn = sqlite3.connect(DB_PATH)
            try:
                council = funcs["c_input"].load_council_output(conn, symbol=symbol, as_of=as_of_ms)
                state = funcs["graph"].invoke(
                    {
                        "symbol": council["symbol"],
                        "as_of": council["as_of"],
                        "snapshot": council["snapshot"],
                        "fundamentals": council["fundamentals"],
                        "sentiment": council["sentiment"],
                        "technicals": council["technicals"],
                    }
                )
                state["sqlite_decision_id"] = funcs["dc_store"].log_debate(conn, state)
            finally:
                conn.close()

        elif layer_folder == "drl-sizing":
            conn = sqlite3.connect(DB_PATH)
            try:
                debate = funcs["d_input"].load_debate_output(conn, symbol=symbol, as_of=as_of_ms)
                market_snapshot = funcs["l_market"].load_market_snapshot(
                    symbol=symbol, as_of=debate["as_of"]
                )
                state = funcs["graph"].invoke(
                    {
                        "symbol": debate["symbol"],
                        "as_of": debate["as_of"],
                        "final_decision": debate["final_decision"],
                        "final_score": debate["final_score"],
                        "decisive_side": debate["decisive_side"],
                        "market_snapshot": market_snapshot,
                    }
                )
                state.pop("market_snapshot", None)
                state.pop("execution_candidates", None)
                state["sqlite_decision_id"] = funcs["drl_store"].log_result(conn, state)
            finally:
                conn.close()

        elif layer_folder == "risk-memory":
            try:
                import risk_memory.config as rm_cfg

                rm_cfg.DB_PATH = DB_PATH
            except Exception:
                pass
            funcs["rm_graph"].run_pipeline(symbol, as_of_iso)
    finally:
        if sys.path[0] == cache["cwd"]:
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


def fetch_drl_risk_fraction(symbol: str, as_of_ms: int, db_path: str) -> Optional[float]:
    """Read the DRL risk fraction using the shared millisecond timestamp type."""
    as_of_ms = int(as_of_ms)
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
                "SELECT selected_risk_pct FROM drl_sizing_decisions WHERE symbol = ? AND CAST(as_of AS INTEGER) = ? ORDER BY id DESC LIMIT 1",
                (symbol, as_of_ms),
            ).fetchone()
            if row and row[0] is not None:
                return row[0]
        if "risk_fraction" in cols:
            row = conn.execute(
                "SELECT risk_fraction FROM drl_sizing_decisions WHERE symbol = ? AND CAST(as_of AS INTEGER) = ? ORDER BY id DESC LIMIT 1",
                (symbol, as_of_ms),
            ).fetchone()
            if row and row[0] is not None:
                return row[0]
        return None
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()
