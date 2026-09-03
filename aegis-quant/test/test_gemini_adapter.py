#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import pipeline

class FakeResponse:
    def raise_for_status(self):
        pass
    def json(self):
        return {"candidates": [{"content": {"parts": [{"text": json.dumps({"label": "bullish", "score": 0.7, "reason": "mocked Gemini response"})}]}}]}

def fake_post(url, **kwargs):
    assert url.endswith(":generateContent")
    assert kwargs["params"]["key"] == "test-key"
    body = kwargs["json"]
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["responseSchema"]["properties"]["label"]["enum"] == ["bullish", "bearish", "neutral"]
    return FakeResponse()

old_post = pipeline.requests.post
old_key = os.environ.get("GEMINI_API_KEY")
pipeline.requests.post = fake_post
os.environ["GEMINI_API_KEY"] = "test-key"
try:
    result = pipeline.sentiment_agent({"close": 100, "rsi": 55, "macd": 1, "macd_signal": 0.5, "bb_mid": 99, "bb_upper": 101, "bb_lower": 97, "volatility": 0.01, "return_1h": 0.002})
    assert result["label"] == "bullish"
    assert result["score"] == 0.7
finally:
    pipeline.requests.post = old_post
    if old_key is None:
        os.environ.pop("GEMINI_API_KEY", None)
    else:
        os.environ["GEMINI_API_KEY"] = old_key
print("✓ Gemini generateContent adapter test passed")
