import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from risk.risk_gate import apply_risk_gate


class TestRiskGate(unittest.TestCase):
    def test_no_signal_passes_through(self):
        passed, reason, decision = apply_risk_gate(None, 0.0, 2.0, 50)
        self.assertTrue(passed)
        self.assertEqual(reason, "no_signal")
        self.assertIsNone(decision)

    def test_insufficient_history_passes_through(self):
        passed, reason, decision = apply_risk_gate("LONG", 5.0, 0.1, 3)
        self.assertTrue(passed)
        self.assertEqual(reason, "insufficient_history")
        self.assertEqual(decision, "LONG")

    def test_drawdown_breach_blocks(self):
        passed, reason, decision = apply_risk_gate("LONG", 3.5, 2.0, 20)
        self.assertFalse(passed)
        self.assertEqual(reason, "drawdown_breach")
        self.assertIsNone(decision)

    def test_sharpe_failure_blocks(self):
        passed, reason, decision = apply_risk_gate("SHORT", 1.0, 0.2, 20)
        self.assertFalse(passed)
        self.assertEqual(reason, "sharpe_failure")
        self.assertIsNone(decision)

    def test_healthy_metrics_pass(self):
        passed, reason, decision = apply_risk_gate("LONG", 1.0, 1.5, 20)
        self.assertTrue(passed)
        self.assertEqual(reason, "ok")
        self.assertEqual(decision, "LONG")


if __name__ == "__main__":
    unittest.main()
