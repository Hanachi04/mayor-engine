"""CLI entry point for Layer 4 (Risk Gate + Memory + Reflection).

Usage:
    python3 main.py --symbol BTCUSDT --as-of 2026-09-04T00:00:00
"""

import argparse
import json

from graph import run_pipeline


def main():
    parser = argparse.ArgumentParser(description="Run the Risk Gate + Memory + Reflection layer.")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--as-of", required=True, dest="as_of")
    args = parser.parse_args()

    result = run_pipeline(args.symbol, args.as_of)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
