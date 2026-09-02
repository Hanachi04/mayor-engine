import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from graph import build_graph  # noqa: E402
from adapters import council_input  # noqa: E402
from persistence import sqlite_store  # noqa: E402

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "aegis.sqlite3")


def run_once(symbol: str = "BTCUSDT", as_of: int | None = None) -> dict:
    conn = sqlite3.connect(DB_PATH)
    try:
        council = council_input.load_council_output(conn, symbol=symbol, as_of=as_of)
        graph = build_graph()
        state = graph.invoke({
            "symbol": council["symbol"],
            "as_of": council["as_of"],
            "snapshot": council["snapshot"],
            "fundamentals": council["fundamentals"],
            "sentiment": council["sentiment"],
            "technicals": council["technicals"],
        })
        state["sqlite_decision_id"] = sqlite_store.log_debate(conn, state)
    finally:
        conn.close()
    return state


if __name__ == "__main__":
    result = run_once()
    print(result)
