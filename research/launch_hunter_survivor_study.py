"""Delayed launch-survivor basket study using frozen two-hour candidates."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "launch_hunter_multicohort_results"
PONS = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044"


def normalized(frame: pd.DataFrame, eth_side: int) -> pd.DataFrame:
    f = frame.sort_values("bucket").copy()
    raw = (f.close_sqrt.astype(float) / 2**96) ** 2
    f["price"] = pd.to_numeric(raw if eth_side == 1 else 1 / raw, errors="coerce")
    f = f[np.isfinite(f["price"].astype(float)) & (f["price"] > 0)]
    if f.empty:
        return f
    f["multiple"] = f.price / f.iloc[0].price
    return f


def replay(f: pd.DataFrame, decision_h: int, min_multiple: float, min_volume_6h: float,
           stop: float, recovery: float, trail: float, max_hold: int) -> dict:
    decision_bucket = decision_h * 4
    prior = f[f.bucket <= decision_bucket]
    if prior.empty:
        return {"selected": False, "return_pct": 0.0, "recovered": False, "score_volume_6h": 0.0}
    entry_row = prior.iloc[-1]
    recent = prior[prior.bucket > decision_bucket - 24]
    if (entry_row.multiple < min_multiple or recent.volume_eth.sum() < min_volume_6h
            or recent.swaps.sum() < 48 or recent.bucket.nunique() < 12):
        return {"selected": False, "return_pct": 0.0, "recovered": False, "score_volume_6h": float(recent.volume_eth.sum())}
    entry = float(entry_row.multiple)
    tokens, cash, peak, recovered = .99 / entry, 0.0, entry, False
    future = f[(f.bucket > entry_row.bucket) & (f.bucket <= entry_row.bucket + max_hold * 4)]
    exit_price = entry
    for row in future.itertuples():
        price = float(row.multiple)
        exit_price, peak = price, max(peak, price)
        if not recovered:
            if price <= entry * (1 - stop):
                cash += tokens * price * .99
                tokens = 0
                break
            if price >= entry * recovery:
                sold = min(tokens, 1 / (price * .99))
                cash += sold * price * .99
                tokens -= sold
                recovered = True
                peak = price
        elif price <= peak * (1 - trail):
            cash += tokens * price * .99
            tokens = 0
            break
    if tokens:
        cash += tokens * exit_price * .99
    return {"selected": True, "return_pct": (cash - 1) * 100, "recovered": recovered,
            "score_volume_6h": float(recent.volume_eth.sum())}


def main() -> None:
    screen = pd.read_csv(OUT / "multicohort_screen.csv")
    candidates = screen[screen.market_gate == True].copy()
    bars = pd.read_csv(OUT / "candidate_7d_bars.csv")
    by_id = {pid: normalized(f, int(candidates.set_index("pool_id").loc[pid, "eth_side"]))
             for pid, f in bars.groupby("pool_id") if pid in set(candidates.pool_id)}
    rows = []
    for decision in (12, 24, 48):
        for minimum in (1.0, 1.25, 1.5, 2.0):
            for volume in (1, 5, 20):
                for stop in (.20, .30):
                    for recovery in (1.5, 2.0):
                        for trail in (.40, .55):
                            for hold in (12, 24, 48, 96):
                                for row in candidates.itertuples():
                                    # Directional mode is restricted to a documented, fixed launch family.
                                    if row.hook != PONS or row.pool_id not in by_id:
                                        result = {"selected": False, "return_pct": 0.0, "recovered": False,
                                                  "score_volume_6h": 0.0}
                                    else:
                                        result = replay(by_id[row.pool_id], decision, minimum, volume,
                                                        stop, recovery, trail, hold)
                                    rows.append({"day": row.day, "pool_id": row.pool_id,
                                        "creator_cluster": row.init_tx_from if isinstance(row.init_tx_from, str) and row.init_tx_from else row.pool_id,
                                        "decision_hours": decision,
                                        "min_multiple": minimum, "min_volume_6h": volume, "stop": stop,
                                        "recovery": recovery, "trail": trail, "max_hold_hours": hold, **result})
    outcome = pd.DataFrame(rows)
    outcome.to_csv(OUT / "survivor_outcomes.csv", index=False)
    keys = ["decision_hours", "min_multiple", "min_volume_6h", "stop", "recovery", "trail", "max_hold_hours"]
    day = outcome.groupby(keys + ["day"]).agg(
        selected=("selected", "sum"), basket_return_pct=("return_pct", lambda s: s[outcome.loc[s.index, "selected"]].mean()
                                                         if outcome.loc[s.index, "selected"].any() else 0),
        recovered=("recovered", "sum"),
    ).reset_index()
    summary = day.groupby(keys).agg(
        selections=("selected", "sum"), active_days=("selected", lambda s: (s > 0).sum()),
        mean_day_return_pct=("basket_return_pct", "mean"), median_day_return_pct=("basket_return_pct", "median"),
        worst_day_return_pct=("basket_return_pct", "min"), best_day_return_pct=("basket_return_pct", "max"),
    ).reset_index()
    summary.to_csv(OUT / "survivor_policy_summary.csv", index=False)
    viable = summary[(summary.selections >= 4) & (summary.active_days >= 3)]
    print(viable.sort_values(["worst_day_return_pct", "mean_day_return_pct"], ascending=False).head(25).to_string(index=False))

    # Basket construction is the edge over a single-launch product: one name per
    # creator cluster, the five strongest continuations, and only 0.5% per name.
    clustered_rows = []
    for group_keys, group in outcome.groupby(keys + ["day"]):
        picks = (group[group.selected].sort_values("score_volume_6h", ascending=False)
                 .drop_duplicates("creator_cluster").head(5))
        clustered_rows.append({
            **dict(zip(keys + ["day"], group_keys)), "positions": len(picks),
            "capital_at_risk_pct": len(picks) * 0.5,
            "vault_return_pct": float((picks.return_pct * .005).sum()),
            "position_return_mean_pct": float(picks.return_pct.mean()) if len(picks) else 0.0,
        })
    clustered = pd.DataFrame(clustered_rows)
    clustered.to_csv(OUT / "survivor_clustered_daily.csv", index=False)
    clustered_summary = clustered.groupby(keys).agg(
        positions=("positions", "sum"), active_days=("positions", lambda s: (s > 0).sum()),
        mean_vault_return_pct=("vault_return_pct", "mean"),
        median_vault_return_pct=("vault_return_pct", "median"),
        worst_vault_return_pct=("vault_return_pct", "min"),
        best_vault_return_pct=("vault_return_pct", "max"),
    ).reset_index()
    clustered_summary.to_csv(OUT / "survivor_clustered_summary.csv", index=False)
    robust = clustered_summary[(clustered_summary.positions >= 4) & (clustered_summary.active_days >= 3)]
    print("\nCreator-clustered 0.5%-per-name vault results")
    print(robust.sort_values(["worst_vault_return_pct", "mean_vault_return_pct"], ascending=False).head(25).to_string(index=False))


if __name__ == "__main__":
    main()
