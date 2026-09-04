"""Deterministic reflection agent — no LLM, pure pattern detection over
recent risk_memory_events. It writes advisory context into
reflection_memory that Layer 1's sentiment_node can read on its next run;
it never blocks a trade itself (that's the risk gate's job).
"""

from typing import List

from config import (
    REPEATED_NEGATIVE_REWARD_MIN_COUNT,
    REPEATED_NEGATIVE_REWARD_WINDOW,
    SIMULATION_REJECTION_CLUSTER_MIN_COUNT,
    SIMULATION_REJECTION_CLUSTER_WINDOW,
)


def detect_repeated_negative_reward(recent_rewards: List[float]) -> bool:
    window = recent_rewards[-REPEATED_NEGATIVE_REWARD_WINDOW:]
    if len(window) < REPEATED_NEGATIVE_REWARD_WINDOW:
        return False
    negative_count = sum(1 for r in window if r < 0)
    return negative_count >= REPEATED_NEGATIVE_REWARD_MIN_COUNT


def detect_drawdown_breach(recent_events: List[dict]) -> bool:
    return any(e.get("risk_gate_reason") == "drawdown_breach" for e in recent_events)


def detect_sharpe_failure(recent_events: List[dict]) -> bool:
    return any(e.get("risk_gate_reason") == "sharpe_failure" for e in recent_events)


def detect_simulation_rejection_cluster(recent_events: List[dict]) -> bool:
    window = recent_events[:SIMULATION_REJECTION_CLUSTER_WINDOW]
    rejected = sum(1 for e in window if e.get("risk_gate_passed") == 0)
    return rejected >= SIMULATION_REJECTION_CLUSTER_MIN_COUNT


_PATTERN_MESSAGES = {
    "REPEATED_NEGATIVE_REWARD": (
        "آخر عدة قرارات DRL حققت مكافأة سالبة بشكل متكرر — يُنصح بالحذر "
        "وتقليل حجم المخاطرة حتى تتحسن الأداء."
    ),
    "DRAWDOWN_BREACH": (
        "تم رصد تجاوز حد التراجع الأقصى (Max Drawdown) مؤخرًا — البوابة "
        "منعت صفقات؛ يُنصح بمراجعة حجم المراكز."
    ),
    "SHARPE_FAILURE": (
        "نسبة شارب التراكمية دون الحد الأدنى المطلوب مؤخرًا — الأداء "
        "المعدّل بالمخاطرة ضعيف حاليًا."
    ),
    "SIMULATION_REJECTION_CLUSTER": (
        "عدد كبير من القرارات الأخيرة تم رفضه من بوابة المخاطر — يوجد "
        "نمط رفض متكرر يستحق المراجعة."
    ),
}


def run_reflection(recent_rewards: List[float], recent_events: List[dict]) -> List[str]:
    """Return the list of pattern names detected in the recent history."""
    patterns = []
    if detect_repeated_negative_reward(recent_rewards):
        patterns.append("REPEATED_NEGATIVE_REWARD")
    if detect_drawdown_breach(recent_events):
        patterns.append("DRAWDOWN_BREACH")
    if detect_sharpe_failure(recent_events):
        patterns.append("SHARPE_FAILURE")
    if detect_simulation_rejection_cluster(recent_events):
        patterns.append("SIMULATION_REJECTION_CLUSTER")
    return patterns


def build_reflection_context(patterns: List[str]) -> str:
    if not patterns:
        return ""
    messages = [_PATTERN_MESSAGES[p] for p in patterns if p in _PATTERN_MESSAGES]
    return " ".join(messages)
