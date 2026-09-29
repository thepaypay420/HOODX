"""Scale the frozen 12-hour survivor policy and stress extra round-trip friction."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "launch_hunter_multicohort_results" / "survivor_clustered_daily.csv"
OUTPUT = ROOT / "launch_hunter_multicohort_results" / "launch_hunter_v2_sizing.json"


def main() -> None:
    data = pd.read_csv(SOURCE)
    chosen = data[
        (data.decision_hours == 12)
        & (data.min_multiple == 1.0)
        & (data.min_volume_6h == 5)
        & (data.stop == 0.2)
        & (data.recovery == 1.5)
        & (data.trail == 0.55)
        & (data.max_hold_hours == 24)
    ].copy()
    if len(chosen) != 4 or int(chosen.positions.sum()) != 8:
        raise RuntimeError("frozen cohort selection changed")

    scenarios = []
    for allocation_pct in (5.0, 7.5, 10.0):
        scale = allocation_pct / 0.5
        for extra_round_trip_cost_pct in (0.0, 2.0, 5.0, 10.0):
            returns = chosen.vault_return_pct * scale - chosen.positions * allocation_pct * extra_round_trip_cost_pct / 100
            scenarios.append(
                {
                    "allocationPctPerCandidate": allocation_pct,
                    "extraRoundTripCostPctPerCandidate": extra_round_trip_cost_pct,
                    "cohortVaultReturnsPct": [round(x, 6) for x in returns],
                    "meanPct": round(float(returns.mean()), 6),
                    "medianPct": round(float(returns.median()), 6),
                    "worstPct": round(float(returns.min()), 6),
                    "bestPct": round(float(returns.max()), 6),
                }
            )

    report = {
        "policy": {
            "decisionHours": 12,
            "minimumPriceVsTwoHourReference": 1.0,
            "minimumSixHourVolumeEth": 5,
            "stop": 0.2,
            "principalRecoveryMultiple": 1.5,
            "trailingDrawdown": 0.55,
            "maximumHoldHours": 24,
        },
        "sample": {
            "calendarCohorts": 4,
            "positions": int(chosen.positions.sum()),
            "meanPositionsPerActiveCohort": float(chosen.positions.mean()),
            "baseTradeActionsPerActiveCohort": float(chosen.positions.mean() * 2),
            "warning": "One extreme winner dominates every positive mean. These are sensitivity tests, not forecasts or APR.",
        },
        "scenarios": scenarios,
    }
    OUTPUT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
