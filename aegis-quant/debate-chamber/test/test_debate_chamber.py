import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from graph import build_graph  # noqa: E402


def _fake_council_state(rsi, macd, macd_signal, close, bb_mid, sentiment_label):
    return {
        "symbol": "BTCUSDT",
        "as_of": 1700000000000,
        "snapshot": {"close": close},
        "fundamentals": {"market_cap": None, "view": "neutral", "score": 0.0, "reason": "n/a"},
        "sentiment": {"label": sentiment_label, "score": 0.0, "reason": "test"},
        "technicals": {
            "view": "neutral", "score": 0.0, "reason": "test",
            "indicators": {
                "rsi": rsi, "macd": macd, "macd_signal": macd_signal,
                "bb_mid": bb_mid, "bb_upper": bb_mid * 1.02, "bb_lower": bb_mid * 0.98,
                "volatility": 0.001,
            },
        },
    }


class TestDebateChamber(unittest.TestCase):
    def test_strong_bullish_evidence_produces_long(self):
        graph = build_graph()
        state = graph.invoke(_fake_council_state(
            rsi=25, macd=10, macd_signal=5, close=71000, bb_mid=70000,
            sentiment_label="bullish",
        ))
        self.assertEqual(state["final_decision"], "LONG")
        self.assertEqual(state["decisive_side"], "BULL")
        self.assertGreaterEqual(state["final_score"], 0.25)
        self.assertEqual(state["risk_pct"], 0.35)

    def test_strong_bearish_evidence_produces_short(self):
        graph = build_graph()
        state = graph.invoke(_fake_council_state(
            rsi=75, macd=-10, macd_signal=-5, close=69000, bb_mid=70000,
            sentiment_label="bearish",
        ))
        self.assertEqual(state["final_decision"], "SHORT")
        self.assertEqual(state["decisive_side"], "BEAR")
        self.assertLessEqual(state["final_score"], -0.25)
        self.assertEqual(state["risk_pct"], 0.35)

    def test_mixed_evidence_produces_no_decision(self):
        # RSI mid-range (no vote), MACD slightly bullish, close slightly
        # bearish, sentiment neutral -> evenly split, margin should be small.
        graph = build_graph()
        state = graph.invoke(_fake_council_state(
            rsi=50, macd=1, macd_signal=0, close=69990, bb_mid=70000,
            sentiment_label="neutral",
        ))
        self.assertIsNone(state["final_decision"])
        self.assertEqual(state["decisive_side"], "TIE")
        self.assertEqual(state["risk_pct"], 0.0)

    def test_both_sides_record_opposing_evidence(self):
        # RSI deep bullish signal but everything else bearish: bull case
        # must still list the bearish MACD/close/sentiment as risks, and
        # bear case must list the RSI as a risk against itself.
        graph = build_graph()
        state = graph.invoke(_fake_council_state(
            rsi=25, macd=-10, macd_signal=-5, close=69000, bb_mid=70000,
            sentiment_label="bearish",
        ))
        bull_risks = " ".join(state["bull_case"]["risks"])
        bear_risks = " ".join(state["bear_case"]["risks"])
        self.assertIn("MACD", bull_risks)
        self.assertIn("RSI", bear_risks)


if __name__ == "__main__":
    unittest.main()
