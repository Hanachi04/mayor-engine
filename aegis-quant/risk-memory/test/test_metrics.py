import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from metrics.drawdown import compute_max_drawdown_pct
from metrics.sharpe import compute_cumulative_sharpe


class TestDrawdown(unittest.TestCase):
    def test_no_drawdown_on_monotonic_rise(self):
        curve = [100, 105, 110, 120]
        self.assertEqual(compute_max_drawdown_pct(curve), 0.0)

    def test_simple_drawdown(self):
        curve = [100, 120, 90, 130]
        # peak 120 -> trough 90 => (120-90)/120*100 = 25%
        self.assertAlmostEqual(compute_max_drawdown_pct(curve), 25.0, places=5)

    def test_empty_or_single_point(self):
        self.assertEqual(compute_max_drawdown_pct([]), 0.0)
        self.assertEqual(compute_max_drawdown_pct([100]), 0.0)


class TestSharpe(unittest.TestCase):
    def test_insufficient_data(self):
        self.assertEqual(compute_cumulative_sharpe([]), 0.0)
        self.assertEqual(compute_cumulative_sharpe([1.0]), 0.0)

    def test_zero_variance_returns_zero(self):
        self.assertEqual(compute_cumulative_sharpe([1.0, 1.0, 1.0]), 0.0)

    def test_positive_sharpe(self):
        returns = [1.0, 2.0, 1.5, 2.5, 1.0]
        sharpe = compute_cumulative_sharpe(returns)
        self.assertGreater(sharpe, 0.0)


if __name__ == "__main__":
    unittest.main()
