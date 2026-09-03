import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from graph import build_graph  # noqa: E402


def _snapshot(entry_price=70000.0, volatility=0.002, candles=None):
    return {
        "symbol": "BTCUSDT",
        "entry_index": 5,
        "entry_time": 1700000000000,
        "entry_price": entry_price,
        "volatility": volatility,
        "candles": candles or [],
    }


def _flat_candles(n=10, price=70000.0, step_ms=3_600_000, start_ts=1700000000000):
    candles = []
    t = start_ts
    for _ in range(n):
        candles.append({
            "open_time": t, "close_time": t + 3599999,
            "open": price, "high": price * 1.001, "low": price * 0.999,
            "close": price, "volume": 100.0,
        })
        t += step_ms
    return candles


class TestDirectionInvariance(unittest.TestCase):
    def _run(self, direction):
        candles = _flat_candles()
        snapshot = _snapshot(entry_price=candles[0]["close"], candles=candles)
        snapshot["entry_time"] = candles[0]["close_time"]
        graph = build_graph()
        return graph.invoke({
            "symbol": "BTCUSDT",
            "as_of": snapshot["entry_time"],
            "final_decision": direction,
            "final_score": 0.9,
            "decisive_side": "BULL" if direction == "LONG" else "BEAR",
            "market_snapshot": snapshot,
        })

    def test_long_direction_never_flips_to_short(self):
        state = self._run("LONG")
        self.assertEqual(state["final_decision"], "LONG")

    def test_short_direction_never_flips_to_long(self):
        state = self._run("SHORT")
        self.assertEqual(state["final_decision"], "SHORT")

    def test_none_direction_is_rejected_not_defaulted(self):
        candles = _flat_candles()
        snapshot = _snapshot(entry_price=candles[0]["close"], candles=candles)
        snapshot["entry_time"] = candles[0]["close_time"]
        graph = build_graph()
        state = graph.invoke({
            "symbol": "BTCUSDT",
            "as_of": snapshot["entry_time"],
            "final_decision": None,
            "final_score": 0.1,
            "decisive_side": "TIE",
            "market_snapshot": snapshot,
        })
        self.assertIsNone(state["final_decision"])
        self.assertEqual(state["execution_status"], "REJECTED_NO_DIRECTION")


if __name__ == "__main__":
    unittest.main()
