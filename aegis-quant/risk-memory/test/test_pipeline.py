import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import config  # noqa: E402


class TestPipeline(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.mkdtemp()
        self._db_path = os.path.join(self._tmp_dir, "aegis_test.sqlite3")
        config.DB_PATH = self._db_path

        conn = sqlite3.connect(self._db_path)
        conn.execute(
            """
            CREATE TABLE drl_sizing_decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT,
                as_of TEXT,
                direction TEXT,
                risk_fraction REAL,
                timing_offset REAL,
                reward REAL
            )
            """
        )
        rows = [
            ("BTCUSDT", f"2026-09-{day:02d}T00:00:00", "LONG", 0.1, 0.0, reward)
            for day, reward in zip(range(1, 16), [1.0, 1.2, -0.5, 0.8, 1.1,
                                                    0.9, -0.3, 1.4, 1.0, 0.6,
                                                    1.3, 0.7, 1.1, 0.9, 1.0])
        ]
        conn.executemany(
            "INSERT INTO drl_sizing_decisions (symbol, as_of, direction, risk_fraction, timing_offset, reward) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            rows,
        )
        conn.commit()
        conn.close()

        # Reload modules that captured DB_PATH at import time.
        import importlib

        import adapters.drl_input as drl_input_mod
        import adapters.historical_memory as hist_mod
        import persistence.sqlite_store as store_mod

        importlib.reload(store_mod)
        importlib.reload(drl_input_mod)
        importlib.reload(hist_mod)

        import graph as graph_mod

        importlib.reload(graph_mod)
        self.graph_mod = graph_mod

    def tearDown(self):
        import shutil

        shutil.rmtree(self._tmp_dir, ignore_errors=True)

    def test_pipeline_produces_final_decision_with_enough_history(self):
        result = self.graph_mod.run_pipeline("BTCUSDT", "2026-09-15T00:00:00")
        self.assertEqual(result["drl_direction"], "LONG")
        self.assertGreaterEqual(result["metric_observations"], config.MIN_METRIC_OBSERVATIONS)
        self.assertIn(result["risk_gate_reason"], ("ok", "drawdown_breach", "sharpe_failure"))
        # Whatever the gate decided, final_decision must be consistent with it.
        if result["risk_gate_passed"]:
            self.assertEqual(result["final_decision"], "LONG")
        else:
            self.assertIsNone(result["final_decision"])

    def test_pipeline_with_no_history_passes_through(self):
        result = self.graph_mod.run_pipeline("ETHUSDT", "2026-09-15T00:00:00")
        self.assertIsNone(result["drl_direction"])
        self.assertEqual(result["risk_gate_reason"], "no_signal")
        self.assertIsNone(result["final_decision"])


if __name__ == "__main__":
    unittest.main()
