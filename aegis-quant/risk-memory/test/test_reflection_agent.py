import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from reflection.reflection_agent import build_reflection_context, run_reflection


class TestReflectionAgent(unittest.TestCase):
    def test_no_patterns_on_healthy_history(self):
        rewards = [1.0, 2.0, 1.5, 0.5, 1.2]
        events = [{"risk_gate_passed": 1, "risk_gate_reason": "ok"} for _ in range(5)]
        patterns = run_reflection(rewards, events)
        self.assertEqual(patterns, [])
        self.assertEqual(build_reflection_context(patterns), "")

    def test_repeated_negative_reward_detected(self):
        rewards = [-1.0, -2.0, 0.5, -1.5, -0.5]  # 4 of last 5 negative
        events = []
        patterns = run_reflection(rewards, events)
        self.assertIn("REPEATED_NEGATIVE_REWARD", patterns)
        self.assertTrue(len(build_reflection_context(patterns)) > 0)

    def test_drawdown_breach_detected(self):
        rewards = [1.0, 1.0]
        events = [{"risk_gate_passed": 0, "risk_gate_reason": "drawdown_breach"}]
        patterns = run_reflection(rewards, events)
        self.assertIn("DRAWDOWN_BREACH", patterns)

    def test_sharpe_failure_detected(self):
        rewards = [1.0, 1.0]
        events = [{"risk_gate_passed": 0, "risk_gate_reason": "sharpe_failure"}]
        patterns = run_reflection(rewards, events)
        self.assertIn("SHARPE_FAILURE", patterns)

    def test_simulation_rejection_cluster_detected(self):
        rewards = [1.0, 1.0]
        events = [{"risk_gate_passed": 0, "risk_gate_reason": "drawdown_breach"}] * 5
        patterns = run_reflection(rewards, events)
        self.assertIn("SIMULATION_REJECTION_CLUSTER", patterns)


if __name__ == "__main__":
    unittest.main()
