import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from environment.execution_env import simulate_candidate  # noqa: E402
import config  # noqa: E402


def _candles(n=10, start_price=70000.0, drift=1.0, start_ts=1700000000000):
    candles = []
    t = start_ts
    price = start_price
    for _ in range(n):
        candles.append({
            "open_time": t, "close_time": t + 3599999,
            "open": price, "high": price + 50, "low": price - 50,
            "close": price + drift, "volume": 100.0,
        })
        price += drift
        t += 3_600_000
    return candles


class TestExecutionTiming(unittest.TestCase):
    def test_only_configured_offsets_are_used(self):
        candles = _candles()
        snapshot = {
            "symbol": "BTCUSDT", "entry_index": 0, "entry_time": candles[0]["close_time"],
            "entry_price": candles[0]["close"], "volatility": 0.001, "candles": candles,
        }
        for offset in config.TIMING_OFFSETS_MS:
            result = simulate_candidate("LONG", snapshot, 0.2, offset)
            self.assertFalse(result.get("invalid_action"))
            self.assertEqual(result["timing_offset_ms"], offset)

    def test_no_lookahead_beyond_available_candles(self):
        candles = _candles(n=1)
        snapshot = {
            "symbol": "BTCUSDT", "entry_index": 0, "entry_time": candles[0]["close_time"],
            "entry_price": candles[0]["close"], "volatility": 0.001, "candles": candles,
        }
        for offset in config.TIMING_OFFSETS_MS:
            result = simulate_candidate("LONG", snapshot, 0.2, offset)
            self.assertTrue(result.get("invalid_action"))

    def test_slippage_decreases_as_wait_increases(self):
        candles = _candles()
        snapshot = {
            "symbol": "BTCUSDT", "entry_index": 0, "entry_time": candles[0]["close_time"],
            "entry_price": candles[0]["close"], "volatility": 0.001, "candles": candles,
        }
        immediate = simulate_candidate("LONG", snapshot, 0.2, 0)
        waited = simulate_candidate("LONG", snapshot, 0.2, max(config.TIMING_OFFSETS_MS))
        self.assertGreaterEqual(immediate["slippage_bps"], waited["slippage_bps"])


if __name__ == "__main__":
    unittest.main()
