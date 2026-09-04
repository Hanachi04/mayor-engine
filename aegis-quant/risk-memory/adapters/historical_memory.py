"""Historical data access for risk metrics and the reflection agent.

Pulls the recent reward/equity history straight from drl_sizing_decisions
(Layer 3's table) and the layer's own risk_memory_events table, so both
the risk gate's metric computation and the reflection agent work off the
same shared source of truth.
"""

import sqlite3
from typing import List

from config import DB_PATH


def fetch_recent_rewards(symbol: str, as_of: str, limit: int = 50, db_path: str = DB_PATH) -> List[float]:
    """Return the most recent `limit` DRL rewards for `symbol`, oldest first."""
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='drl_sizing_decisions'"
        )
        if cursor.fetchone() is None:
            return []

        rows = conn.execute(
            """
            SELECT reward FROM drl_sizing_decisions
            WHERE symbol = ? AND as_of <= ? AND reward IS NOT NULL
            ORDER BY as_of DESC
            LIMIT ?
            """,
            (symbol, as_of, limit),
        ).fetchall()
        rewards = [r[0] for r in rows]
        rewards.reverse()  # oldest first, for equity-curve / Sharpe math
        return rewards
    finally:
        conn.close()


def rewards_to_equity_curve(rewards: List[float], starting_equity: float = 100.0) -> List[float]:
    """Turn a series of rewards into a cumulative equity curve for drawdown math."""
    curve = [starting_equity]
    running = starting_equity
    for r in rewards:
        running += r
        curve.append(running)
    return curve
