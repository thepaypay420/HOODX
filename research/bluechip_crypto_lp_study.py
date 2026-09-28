"""Robinhood Chain blue-chip crypto LP venue and management study.

The chain currently has one institutionally credible crypto asset with material
DEX liquidity: WETH.  This study compares the meaningful WETH/USDG
concentrated-liquidity venues, tests identical management grids, and measures
net LP excess versus simply holding the starting WETH/USDG mix.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests
import urllib3

from lp_month_backtest import Pool, current_active_liquidity, simulate


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "bluechip_crypto_lp_results"
OUT.mkdir(exist_ok=True)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
SESSION = requests.Session()
SESSION.verify = False


@dataclass(frozen=True)
class Venue:
    label: str
    protocol: str
    address: str
    fee_ppm: int
    gecko_token: str
    adapter_status: str


VENUES = [
    Venue("Uniswap v3 1bp", "Uniswap v3", "0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca", 100, "quote", "reviewed_model"),
    Venue("Uniswap v3 5bp", "Uniswap v3", "0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a", 500, "quote", "reviewed_model"),
    Venue("Ramses v3 1bp", "Ramses v3", "0xfae65eaa11943f45e83d5b45dc7a7c801c51bfb0", 100, "base", "unverified_adapter"),
    Venue("Sushi v3 5bp", "Sushi v3", "0x9b050cb1f265094b0977160a2bd7da8c9e529c3c", 500, "base", "unverified_adapter"),
    Venue("Up v3 5bp", "Up v3", "0x16679e2ac1a798865ecf1c1639e67693ddb1c220", 500, "base", "unverified_adapter"),
    Venue("Alandale CL 0.6bp", "Alandale CL", "0x7a35168956f129c032ec035cc47383a605a71df0", 60, "base", "unverified_adapter"),
    Venue("Giga v3 0.5bp", "Giga v3", "0xf4d0171f995d576b972aa982080eaf4da456cf9e", 50, "base", "unverified_adapter"),
]

PILOT_WEIGHTS = {
    "Uniswap v3 1bp": 0.50,
    "Uniswap v3 5bp": 0.20,
    "Up v3 5bp": 0.15,
    "Ramses v3 1bp": 0.05,
}
RESERVE_WEIGHT = 0.10


def model_pool(venue: Venue, tvl: float) -> Pool:
    return Pool(
        venue.label,
        venue.address,
        venue.fee_ppm,
        "WETH",
        "USDG",
        18,
        6,
        0,
        venue.gecko_token,
        tvl,
    )


def get_json(url: str) -> dict:
    for attempt in range(6):
        response = SESSION.get(url, timeout=45)
        if response.ok:
            return response.json()
        time.sleep(2**attempt)
    raise RuntimeError(f"upstream unavailable: {url}")


def metadata(venue: Venue) -> dict:
    path = OUT / f"metadata_{venue.address.lower()}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    payload = get_json(f"https://api.geckoterminal.com/api/v2/networks/robinhood/pools/{venue.address}")
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def candles(venue: Venue, hours: int = 720) -> pd.DataFrame:
    path = OUT / f"candles_{venue.address.lower()}.json"
    if path.exists():
        rows = json.loads(path.read_text(encoding="utf-8"))
    else:
        url = (
            f"https://api.geckoterminal.com/api/v2/networks/robinhood/pools/{venue.address}"
            f"/ohlcv/hour?aggregate=1&limit={hours}&currency=usd&token={venue.gecko_token}"
        )
        rows = get_json(url)["data"]["attributes"]["ohlcv_list"]
        path.write_text(json.dumps(rows), encoding="utf-8")
    frame = pd.DataFrame(rows, columns=["timestamp", "open", "high", "low", "close", "volume_usd"])
    frame = frame.sort_values("timestamp").drop_duplicates("timestamp")
    frame["time"] = pd.to_datetime(frame.timestamp, unit="s", utc=True).dt.floor("h")
    end = frame.time.max()
    start = max(frame.time.min(), end - pd.Timedelta(hours=hours - 1))
    index = pd.date_range(start=start, end=end, freq="h")
    frame = frame.set_index("time").reindex(index)
    frame["close"] = frame.close.ffill().bfill()
    for column in ["open", "high", "low"]:
        frame[column] = frame[column].fillna(frame.close)
    frame["volume_usd"] = frame.volume_usd.fillna(0.0)
    frame["time"] = frame.index
    return frame.reset_index(drop=True)


def annualize(total_return_pct: float, days: float) -> float:
    base = 1 + total_return_pct / 100
    if base <= 0:
        return -100.0
    return (base ** (365 / days) - 1) * 100


def simple_annualize(total_return_pct: float, days: float) -> float:
    return total_return_pct * 365 / days


def position_capacity(initial_share_pct: float, tvl: float) -> dict[str, float]:
    """Cap a pilot at 0.5% of active liquidity and 1% of pool TVL.

    The simulation always starts with $10,000, so the share ratio can be
    scaled algebraically without needing protocol-specific liquidity units.
    """
    share = initial_share_pct / 100
    if share <= 0 or share >= 1:
        active_cap = 0.0
    else:
        active_cap = 10_000 * ((0.005 / 0.995) / (share / (1 - share)))
    tvl_cap = tvl * 0.01
    return {
        "active_liquidity_cap_usd": active_cap,
        "one_pct_tvl_cap_usd": tvl_cap,
        "recommended_position_cap_usd": min(active_cap, tvl_cap),
    }


def frozen_active_liquidity() -> dict[str, int]:
    """Freeze one same-block-style research snapshot for reproducibility.

    Active tick liquidity changes whenever the price crosses ticks. Reusing a
    saved snapshot prevents the same historical study from changing between
    runs. It remains an approximation because an archive series is unavailable.
    """
    path = OUT / "active_liquidity_snapshot.json"
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        return {key: int(value) for key, value in payload["liquidity_by_address"].items()}
    values = {
        venue.address.lower(): current_active_liquidity(model_pool(venue, float(metadata(venue)["data"]["attributes"]["reserve_in_usd"])))
        for venue in VENUES
    }
    path.write_text(
        json.dumps(
            {"captured_at": datetime.now(timezone.utc).isoformat(), "liquidity_by_address": {k: str(v) for k, v in values.items()}},
            indent=2,
        ),
        encoding="utf-8",
    )
    return values


def main() -> None:
    screen: list[dict] = []
    grid_rows: list[dict] = []
    active_by_address = frozen_active_liquidity()
    for venue in VENUES:
        attrs = metadata(venue)["data"]["attributes"]
        tvl = float(attrs["reserve_in_usd"])
        frame = candles(venue)
        pool = model_pool(venue, tvl)
        active = active_by_address[venue.address.lower()]
        days = len(frame) / 24
        volume = float(frame.volume_usd.sum())
        gross_fee_apr = volume * venue.fee_ppm / 1_000_000 / tvl * 365 / days * 100
        screen.append(
            {
                **asdict(venue),
                "tvl_usd": tvl,
                "observed_days": days,
                "observed_volume_usd": volume,
                "current_volume_24h_usd": float(attrs["volume_usd"]["h24"]),
                "gross_full_pool_fee_apr_pct": gross_fee_apr,
                "active_liquidity": str(active),
                "start_price": float(frame.iloc[0].close),
                "end_price": float(frame.iloc[-1].close),
            }
        )
        for width in [0.025, 0.05, 0.075, 0.10, 0.15, 0.20, 0.30]:
            for dwell in [4, 12, 24]:
                for cooldown in [24, 72, 168]:
                    for fee_capture in [1.0, 0.50, 0.25]:
                        result = simulate(pool, frame, active, width, dwell, cooldown, 168, fee_capture)
                        grid_rows.append(
                            {
                                "venue": venue.label,
                                "protocol": venue.protocol,
                                "adapter_status": venue.adapter_status,
                                "half_width_pct": width * 100,
                                "dwell_hours": dwell,
                                "cooldown_hours": cooldown,
                                "fee_capture_pct": fee_capture * 100,
                                "net_apy_pct": annualize(result["net_return_pct"], days),
                                "hodl_apy_pct": annualize(result["hodl_return_pct"], days),
                                "excess_apy_pct": annualize(result["excess_vs_hodl_pct"], days),
                                **{k: v for k, v in result.items() if k not in {"values", "series"}},
                            }
                        )

    screen_frame = pd.DataFrame(screen)
    grid = pd.DataFrame(grid_rows)
    qualified = grid[(grid.fee_capture_pct == 25) & (grid.time_in_range_pct >= 85) & (grid.rebalances <= 6)].copy()
    qualified["robust_score"] = (
        qualified.excess_apy_pct
        + 0.20 * qualified.net_apy_pct
        + 0.50 * qualified.max_drawdown_pct
        - 0.50 * qualified.rebalances
    )
    best = qualified.sort_values(["venue", "robust_score"], ascending=[True, False]).groupby("venue").head(1)

    # Persistence matters more than a single annualized headline.  Report how
    # concentrated the observed volume was, whether the latest week accelerated
    # or faded, and how the fixed policy behaved in three untouched time folds.
    persistence_rows: list[dict] = []
    fold_rows: list[dict] = []
    decay_rows: list[dict] = []
    capacity_rows: list[dict] = []
    portfolio_legs: list[dict] = []
    screen_by_venue = screen_frame.set_index("label")
    for _, policy in best.iterrows():
        venue = next(v for v in VENUES if v.label == policy.venue)
        frame = candles(venue)
        tvl = float(screen_by_venue.loc[venue.label, "tvl_usd"])
        pool = model_pool(venue, tvl)
        active = active_by_address[venue.address.lower()]
        daily = frame.set_index("time").volume_usd.resample("1D").sum()
        top3_share = float(daily.nlargest(min(3, len(daily))).sum() / daily.sum() * 100) if daily.sum() else 0.0
        last7 = float(daily.tail(7).mean())
        prior = float(daily.iloc[:-7].mean()) if len(daily) > 7 else last7
        daily_fee_apr = daily * venue.fee_ppm / 1_000_000 / tvl * 365 * 100
        persistence_rows.append(
            {
                "venue": venue.label,
                "daily_volume_median_usd": float(daily.median()),
                "daily_volume_mean_usd": float(daily.mean()),
                "top_3_days_volume_share_pct": top3_share,
                "last_7d_vs_prior_volume_pct": (last7 / prior - 1) * 100 if prior else 0.0,
                "median_full_pool_fee_apr_pct": float(daily_fee_apr.median()),
                "days_with_zero_volume": int((daily == 0).sum()),
            }
        )
        recent_volume_ratio = last7 / prior if prior else 1.0

        policy_args = (
            float(policy.half_width_pct) / 100,
            int(policy.dwell_hours),
            int(policy.cooldown_hours),
            168,
        )
        fold_size = len(frame) // 3
        for fold in range(3):
            start = fold * fold_size
            stop = len(frame) if fold == 2 else (fold + 1) * fold_size
            fold_frame = frame.iloc[start:stop].reset_index(drop=True)
            result = simulate(pool, fold_frame, active, *policy_args, 0.25)
            fold_days = len(fold_frame) / 24
            fold_rows.append(
                {
                    "venue": venue.label,
                    "fold": fold + 1,
                    "from": fold_frame.iloc[0].time.isoformat(),
                    "to": fold_frame.iloc[-1].time.isoformat(),
                    "days": fold_days,
                    "net_return_pct": result["net_return_pct"],
                    "hodl_return_pct": result["hodl_return_pct"],
                    "excess_vs_hodl_pct": result["excess_vs_hodl_pct"],
                    "simple_annualized_excess_pct": simple_annualize(result["excess_vs_hodl_pct"], fold_days),
                    "time_in_range_pct": result["time_in_range_pct"],
                    "rebalances": result["rebalances"],
                }
            )

        # Fee-decay curve: only a fraction of observed raw fees reaches the LP.
        for capture in [0.05, 0.10, 0.15, 0.25, 0.50, 1.0]:
            for volume_case, volume_ratio in [("observed_month", 1.0), ("latest_7d_run_rate", recent_volume_ratio)]:
                scenario_frame = frame.copy()
                scenario_frame["volume_usd"] *= volume_ratio
                result = simulate(pool, scenario_frame, active, *policy_args, capture)
                row = {
                    "venue": venue.label,
                    "volume_case": volume_case,
                    "volume_multiplier": volume_ratio,
                    "fee_capture_pct": capture * 100,
                    "net_return_pct": result["net_return_pct"],
                    "hodl_return_pct": result["hodl_return_pct"],
                    "excess_vs_hodl_pct": result["excess_vs_hodl_pct"],
                    "simple_annualized_excess_pct": simple_annualize(result["excess_vs_hodl_pct"], len(frame) / 24),
                    "net_fee_income_pct": (result["fees_to_position_usd"] - result["costs_usd"]) / 10_000 * 100,
                    "fees_to_position_usd": result["fees_to_position_usd"],
                    "costs_usd": result["costs_usd"],
                }
                decay_rows.append(row)
                if venue.label in PILOT_WEIGHTS:
                    portfolio_legs.append({**row, "weight": PILOT_WEIGHTS[venue.label]})

        full_result = simulate(pool, frame, active, *policy_args, 0.25)
        capacity_rows.append(
            {
                "venue": venue.label,
                "tvl_usd": tvl,
                "initial_liquidity_share_pct_at_10k": full_result["initial_liquidity_share_pct"],
                **position_capacity(full_result["initial_liquidity_share_pct"], tvl),
            }
        )

    screen_frame.to_csv(OUT / "venue_screen.csv", index=False)
    grid.to_csv(OUT / "management_grid.csv", index=False)
    best.to_csv(OUT / "best_severe_policy_by_venue.csv", index=False)
    pd.DataFrame(persistence_rows).to_csv(OUT / "volume_persistence.csv", index=False)
    pd.DataFrame(fold_rows).to_csv(OUT / "chronological_folds.csv", index=False)
    pd.DataFrame(decay_rows).to_csv(OUT / "fee_decay.csv", index=False)
    pd.DataFrame(capacity_rows).to_csv(OUT / "capacity_limits.csv", index=False)
    leg_frame = pd.DataFrame(portfolio_legs)
    portfolio = (
        leg_frame.assign(
            weighted_net_return=lambda x: x.net_return_pct * x.weight,
            weighted_hodl_return=lambda x: x.hodl_return_pct * x.weight,
            weighted_excess=lambda x: x.excess_vs_hodl_pct * x.weight,
            weighted_net_fee_income=lambda x: x.net_fee_income_pct * x.weight,
        )
        .groupby(["volume_case", "fee_capture_pct"], as_index=False)
        .agg(
            net_return_pct=("weighted_net_return", "sum"),
            hodl_return_pct=("weighted_hodl_return", "sum"),
            excess_vs_hodl_pct=("weighted_excess", "sum"),
            net_fee_income_pct=("weighted_net_fee_income", "sum"),
        )
    )
    portfolio["reserve_weight_pct"] = RESERVE_WEIGHT * 100
    portfolio["simple_annualized_net_fee_income_pct"] = portfolio.net_fee_income_pct * 365 / 30
    portfolio["compounded_net_fee_apy_pct"] = (1 + portfolio.net_fee_income_pct / 100) ** (365 / 30) * 100 - 100
    portfolio.to_csv(OUT / "pilot_portfolio_scenarios.csv", index=False)
    print(screen_frame[["label", "tvl_usd", "observed_days", "observed_volume_usd", "gross_full_pool_fee_apr_pct", "adapter_status"]].to_string(index=False))
    print("\nBest severe-fee policies:\n")
    print(best[["venue", "half_width_pct", "dwell_hours", "cooldown_hours", "net_apy_pct", "excess_apy_pct", "time_in_range_pct", "rebalances", "max_drawdown_pct"]].to_string(index=False))


if __name__ == "__main__":
    main()
