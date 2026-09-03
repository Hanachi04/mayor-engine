"""
Fundamentals agent. No external API call — reads volume/market_cap from the
local snapshot only. Never fabricates a value for missing fields + raises
instead.

View: {volume_bn: float, market_cap_bn: float}
        where "_bn" = "in billions".

If both fields are present in the snapshot, returns them normalized to billions.
If either is missing, raises ValueError (caller must handle the exception
or ensure data completeness before calling this agent).

This matches the design decision from the original build: data completeness
is non-negotiable; synthesis is not an option.
"""


def fundamentals_node(state: dict) -> dict:
    """Build fundamentals view from snapshot."""
    snapshot = state["snapshot"]

    if "volume" not in snapshot or "market_cap" not in snapshot:
        raise ValueError(
            "snapshot must include 'volume' and 'market_cap' fields. "
            f"Present: {list(snapshot.keys())}"
        )

    volume_bn = snapshot["volume"] / 1e9
    market_cap_bn = snapshot["market_cap"] / 1e9

    return {
        "fundamentals": {
            "volume_bn": volume_bn,
            "market_cap_bn": market_cap_bn,
        }
    }
