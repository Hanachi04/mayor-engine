import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sizing import position_sizer  # noqa: E402
import config  # noqa: E402


class TestSizing(unittest.TestCase):
    def test_risk_fraction_clamped_to_max(self):
        sizing = position_sizer.size_from_action(
            risk_fraction=999.0, equity=10000.0, entry_price=70000.0, stop_distance=0.01,
        )
        self.assertEqual(sizing["risk_pct"], config.MAX_RISK_PCT)

    def test_risk_fraction_never_negative(self):
        sizing = position_sizer.size_from_action(
            risk_fraction=-5.0, equity=10000.0, entry_price=70000.0, stop_distance=0.01,
        )
        self.assertGreaterEqual(sizing["risk_pct"], 0.0)

    def test_notional_and_quantity_are_never_negative(self):
        sizing = position_sizer.size_from_action(
            risk_fraction=0.2, equity=10000.0, entry_price=70000.0, stop_distance=0.01,
        )
        self.assertGreaterEqual(sizing["notional"], 0.0)
        self.assertGreaterEqual(sizing["quantity"], 0.0)

    def test_stop_distance_pct_is_clamped(self):
        tiny_vol = position_sizer.stop_distance_pct(0.0000001)
        huge_vol = position_sizer.stop_distance_pct(10.0)
        self.assertGreaterEqual(tiny_vol, config.MIN_STOP_DISTANCE_PCT)
        self.assertLessEqual(huge_vol, config.MAX_STOP_DISTANCE_PCT)


if __name__ == "__main__":
    unittest.main()
