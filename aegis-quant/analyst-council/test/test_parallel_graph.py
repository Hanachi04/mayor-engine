import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from graph import build_graph  # noqa: E402
from adapters import market_data, groq as groq_adapter  # noqa: E402
import agents.sentiment as sentiment_mod  # noqa: E402


class TestParallelGraph(unittest.TestCase):
    def setUp(self):
        self.calls = []

        def fake_transport(messages):
            self.calls.append(messages)
            return json.dumps({"label": "neutral", "score": 0.0, "reason": "test stub"})

        self._orig_classify = groq_adapter.classify
        self._orig_provider = sentiment_mod.sentiment_provider

        def patched_classify(snapshot, reflection_context=None, transport=None):
            return self._orig_classify(snapshot, reflection_context=reflection_context,
                                        transport=fake_transport)

        groq_adapter.classify = patched_classify
        sentiment_mod.sentiment_provider = groq_adapter

    def tearDown(self):
        groq_adapter.classify = self._orig_classify
        sentiment_mod.sentiment_provider = self._orig_provider

    def test_all_three_agents_run_and_aggregate(self):
        snapshot = market_data.load_snapshot(symbol="BTCUSDT", as_of=None)
        graph = build_graph()
        state = graph.invoke({
            "symbol": "BTCUSDT",
            "as_of": snapshot["close_time"],
            "snapshot": snapshot,
        })
        self.assertIn("fundamentals", state)
        self.assertIn("sentiment", state)
        self.assertIn("technicals", state)
        self.assertIn("council_decision", state)
        self.assertIn(state["council_decision"], ("LONG", "SHORT", None))

    def test_sentiment_prompt_excludes_fundamentals_fields(self):
        snapshot = market_data.load_snapshot(symbol="BTCUSDT", as_of=None)
        graph = build_graph()
        graph.invoke({
            "symbol": "BTCUSDT",
            "as_of": snapshot["close_time"],
            "snapshot": snapshot,
        })
        self.assertEqual(len(self.calls), 1)
        messages = self.calls[0]
        user_content = messages[-1]["content"]
        snapshot_part = user_content.split("Snapshot:")[1]
        self.assertNotIn("market_cap", snapshot_part)
        self.assertNotIn("volume", snapshot_part)
        self.assertIn("rsi", snapshot_part)
        self.assertIn("macd", snapshot_part)


if __name__ == "__main__":
    unittest.main()
