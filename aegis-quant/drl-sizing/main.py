import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from graph import build_graph  # noqa: E402
from adapters import debate_input, local_market  # noqa: E402
from persistence import sqlite_store  # noqa: E402

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "aegis.sqlite3")


def run_once(symbol: str = "BTCUSDT", as_of: int | None = None) -> dict:
    conn = sqlite3.connect(DB_PATH)
    try:
        debate = debate_input.load_debate_output(conn, symbol=symbol, as_of=as_of)
        market_snapshot = local_market.load_market_snapshot(symbol=symbol, as_of=debate["as_of"])

        graph = build_graph()
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
        state["sqlite_decision_id"] = sqlite_store.log_result(conn, state)
    finally:
        conn.close()
    return state


if __name__ == "__main__":
    result = run_once()
    print(result)
