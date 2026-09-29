"""Conservative exit-policy study for the frozen HUNTX V3 entries.

The entry policy and its eight selected trades are inputs, not re-optimized here.
Exit parameters are selected on Sep 13/15 only and reported unchanged on the
Sep 17/20 calendar holdout. Intrabar low/high touches are used, a bar touching
both barriers is charged as a stop, and delayed fills use the later bar close.
"""

from __future__ import annotations

import itertools
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "launch_hunter_multicohort_results"
TRAIN_DAYS = {"2026-09-13", "2026-09-15"}
HOLDOUT_DAYS = {"2026-09-17", "2026-09-20"}


def normalized_ohlc(frame: pd.DataFrame, eth_side: int) -> pd.DataFrame:
    frame = frame.sort_values("bucket").copy()
    scale = float(2**96)
    raw = {name: np.square(frame[f"{name}_sqrt"].astype(float) / scale)
           for name in ("open", "high", "low", "close")}
    first = float(raw["close"].iloc[0])
    if eth_side == 1:
        for name in raw:
            frame[name] = raw[name] / first
    else:
        # Inversion swaps the high and low extrema.
        frame["open"] = first / raw["open"]
        frame["close"] = first / raw["close"]
        frame["high"] = first / raw["low"]
        frame["low"] = first / raw["high"]
    return frame.replace([np.inf, -np.inf], np.nan).dropna(subset=["open", "high", "low", "close"])


def paths() -> dict[str, pd.DataFrame]:
    screen = pd.read_csv(DATA / "multicohort_screen.csv")
    sides = screen.drop_duplicates("pool_id").set_index("pool_id").eth_side.to_dict()
    bars = pd.read_csv(DATA / "candidate_7d_bars.csv")
    selected = set(pd.read_csv(DATA / "launch_hunter_v3_recommended_trades.csv").pool_id)
    return {pool: normalized_ohlc(group, int(sides[pool]))
            for pool, group in bars[bars.pool_id.isin(selected)].groupby("pool_id")}


def replay(path: pd.DataFrame, bucket: int, target: float, stop: float,
           hold_hours: int, friction: float, delay_bars: int) -> dict:
    entry_row = path[path.bucket <= bucket].iloc[-1]
    entry = float(entry_row.close)
    future = path[(path.bucket > bucket) & (path.bucket <= bucket + hold_hours * 4)].reset_index(drop=True)
    trigger = "timeout"
    trigger_index = len(future) - 1
    ambiguous = False
    for i, row in future.iterrows():
        hit_stop = float(row.low) / entry <= 1 - stop
        hit_target = float(row.high) / entry >= 1 + target
        if hit_stop or hit_target:
            ambiguous = bool(hit_stop and hit_target)
            trigger = "stop" if hit_stop else "target"  # adverse-first when ordering is unknowable
            trigger_index = i
            break

    fill_index = min(trigger_index + delay_bars, len(future) - 1)
    if delay_bars:
        delayed = float(future.iloc[fill_index].close) / entry
        # Never credit favorable overshoot after a signal. A delayed target may
        # fade, while a delayed stop may gap further; both effects are charged.
        gross = min(delayed, 1 + target) if trigger == "target" else min(delayed, 1 - stop) if trigger == "stop" else delayed
    elif trigger == "target":
        gross = 1 + target
    elif trigger == "stop":
        # Stops can gap through their threshold; charge the worse observed close.
        gross = min(1 - stop, float(future.iloc[trigger_index].close) / entry)
    else:
        gross = float(future.iloc[-1].close) / entry
    return {
        "return_pct": (gross * (1 - friction) - 1) * 100,
        "trigger": trigger,
        "ambiguous_bar": ambiguous,
        "fill_delay_minutes": delay_bars * 15,
    }


def summarize(rows: pd.DataFrame, days: set[str]) -> dict:
    sample = rows[rows.day.isin(days)]
    daily = sample.groupby("day").return_pct.sum() * .10
    return {
        "trades": int(len(sample)),
        "wins": int((sample.return_pct > 0).sum()),
        "stops": int((sample.trigger == "stop").sum()),
        "ambiguous_bars": int(sample.ambiguous_bar.sum()),
        "median_trade_pct": float(sample.return_pct.median()),
        "portfolio_total_pct": float(sample.return_pct.sum() * .10),
        "portfolio_worst_day_pct": float(daily.min()),
    }


def main() -> None:
    trades = pd.read_csv(DATA / "launch_hunter_v3_recommended_trades.csv")
    series = paths()
    grid_rows = []
    details = []
    for target, stop, hold, friction, delay in itertools.product(
        (.20, .30, .40, .45, .50, .55, .60, .65, .75, 1.00),
        (.15, .18, .20, .22, .25, .30), (2, 3, 4, 6, 8),
        (.05, .08, .10, .12), (0, 1, 2)
    ):
        outcomes = []
        for trade in trades.itertuples():
            result = replay(series[trade.pool_id], int(trade.bucket), target, stop, hold, friction, delay)
            outcome = {"day": trade.day, "pool_id": trade.pool_id, **result}
            outcomes.append(outcome)
            details.append({"target_pct": target * 100, "stop_pct": stop * 100,
                            "hold_hours": hold, "friction_pct": friction * 100,
                            "delay_minutes": delay * 15, **outcome})
        frame = pd.DataFrame(outcomes)
        train = summarize(frame, TRAIN_DAYS)
        holdout = summarize(frame, HOLDOUT_DAYS)
        grid_rows.append({
            "target_pct": target * 100, "stop_pct": stop * 100, "hold_hours": hold,
            "friction_pct": friction * 100, "delay_minutes": delay * 15,
            **{f"train_{k}": v for k, v in train.items()},
            **{f"holdout_{k}": v for k, v in holdout.items()},
        })

    grid = pd.DataFrame(grid_rows)
    grid.to_csv(DATA / "launch_hunter_v3_exit_grid.csv", index=False)

    # Select only with training data from a coarse, operational grid. Nearby
    # 5%-target and 2%-stop perturbations remain in the output as sensitivity
    # checks, but are not eligible to become fine-tuned production constants.
    coarse_targets = {20.0, 30.0, 40.0, 50.0, 60.0, 75.0, 100.0}
    coarse_stops = {15.0, 20.0, 25.0, 30.0}
    baseline = grid[(grid.friction_pct == 5) & (grid.delay_minutes == 0)
                    & grid.target_pct.isin(coarse_targets) & grid.stop_pct.isin(coarse_stops)].copy()
    harsh = grid[(grid.friction_pct == 8) & (grid.delay_minutes == 15)][
        ["target_pct", "stop_pct", "hold_hours", "train_portfolio_worst_day_pct"]
    ].rename(columns={"train_portfolio_worst_day_pct": "harsh_train_worst_day_pct"})
    ranked = baseline.merge(harsh, on=["target_pct", "stop_pct", "hold_hours"])
    ranked = ranked[(ranked.train_portfolio_worst_day_pct > 0) & (ranked.harsh_train_worst_day_pct > 0)]
    ranked["selection_floor"] = ranked[["train_portfolio_worst_day_pct", "harsh_train_worst_day_pct"]].min(axis=1)
    ranked = ranked.sort_values(["selection_floor", "train_portfolio_total_pct"], ascending=False)
    chosen = ranked.iloc[0]

    detail_frame = pd.DataFrame(details)
    detail_frame = detail_frame[
        (detail_frame.target_pct == chosen.target_pct)
        & (detail_frame.stop_pct == chosen.stop_pct)
        & (detail_frame.hold_hours == chosen.hold_hours)
    ]
    detail_frame.to_csv(DATA / "launch_hunter_v3_exit_details.csv", index=False)

    key = (grid.target_pct == chosen.target_pct) & (grid.stop_pct == chosen.stop_pct) & (grid.hold_hours == chosen.hold_hours)
    scenarios = grid[key].sort_values(["friction_pct", "delay_minutes"]).to_dict("records")
    cost_metrics = []
    for friction in (.05, .08, .10, .12):
        reward = (1 + chosen.target_pct / 100) * (1 - friction) - 1
        loss = 1 - (1 - chosen.stop_pct / 100) * (1 - friction)
        cost_metrics.append({"friction_pct": friction * 100,
                             "net_reward_pct": reward * 100, "net_loss_pct": loss * 100,
                             "net_reward_risk": reward / loss,
                             "break_even_win_rate_pct": loss / (reward + loss) * 100})
    result = {
        "method": "coarse train-only selection; local perturbation sensitivity; intrabar barriers; stop-first ambiguous bars; delayed close fills",
        "train_days": sorted(TRAIN_DAYS), "holdout_days": sorted(HOLDOUT_DAYS),
        "chosen": {"target_pct": float(chosen.target_pct), "stop_pct": float(chosen.stop_pct),
                   "hold_hours": int(chosen.hold_hours),
                   "nominal_reward_risk": float(chosen.target_pct / chosen.stop_pct)},
        "selection_floor_pct": float(chosen.selection_floor),
        "after_cost_reward_risk": cost_metrics,
        "scenarios": scenarios,
        "limitations": [
            "Eight trades across four nonconsecutive days are insufficient for an APR claim.",
            "The later cohorts are a mechanical script holdout, but prior V3 analysis had already inspected them; fresh confirmatory dates are required.",
            "15-minute OHLC cannot reveal exact ordering inside a bar; both-touch bars are charged as stops.",
            "Friction scenarios proxy for taxes, price impact, gas and failed execution; exact token replay remains required.",
        ],
    }
    (DATA / "launch_hunter_v3_exit_recommendation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
