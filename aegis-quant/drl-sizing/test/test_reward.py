import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from reward.function import execution_reward  # noqa: E402


class TestReward(unittest.TestCase):
    def test_costs_are_subtracted_from_gross_return(self):
        result = {
            "invalid_action": False,
            "violates_risk_limit": False,
            "gross_return_pct": 1.0,
            "slippage_bps": 10.0,
            "fee_bps": 4.0,
            "drawdown_pct": 0.2,
            "timing_penalty_pct": 0.01,
        }
        reward = execution_reward(result)
        expected = 1.0 - 0.10 - 0.04 - 0.2 - 0.01
        self.assertAlmostEqual(reward, expected, places=6)

    def test_invalid_action_returns_sentinel(self):
        reward = execution_reward({"invalid_action": True})
        import config
        self.assertEqual(reward, config.REJECT_REWARD)

    def test_risk_limit_violation_is_penalized(self):
        base = {
            "invalid_action": False, "violates_risk_limit": False,
            "gross_return_pct": 1.0, "slippage_bps": 0.0, "fee_bps": 0.0,
            "drawdown_pct": 0.0, "timing_penalty_pct": 0.0,
        }
        violating = dict(base, violates_risk_limit=True)
        self.assertLess(execution_reward(violating), execution_reward(base))


if __name__ == "__main__":
    unittest.main()
