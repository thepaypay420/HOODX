"""Stablecoin-only Robinhood Chain LP screen and cadence study.

The script keeps newly-created pools on their true observed history rather than
padding them back to 30 days.  Uniswap v4 pools are screened with full-pool
fee turnover and peg stability because current tick liquidity is not exposed
through a v3-style pool contract.  The Pancake v3 U/USDG pool also receives a
small-position concentrated-liquidity simulation using the shared model.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import urllib3

from lp_month_backtest import Pool, current_active_liquidity, simulate

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "stable_lp_month_results"
OUT.mkdir(exist_ok=True)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
SESSION = requests.Session()
SESSION.verify = False


@dataclass(frozen=True)
class StablePool:
    label: str
    address: str
    protocol: str
    fee_ppm: int
    gecko_token: str
    history_target_hours: int = 720
    screen_only: bool = False


POOLS = [
    StablePool("U/USDG Pancake v3 1bp", "0x090f2f033c16fe92e28f0204435590548aedc3f0", "PancakeSwap v3", 100, "base"),
    StablePool("U/USDG Uniswap v4 0.8bp", "0xf399bd1544377680d48c62fd85c2105b869e55906c4189cc5ab3b4e83446928c", "Uniswap v4", 80, "base"),
    StablePool("USDe/USDG Uniswap v4 1bp", "0xa5f23cae4e5c3388c5a8a6b08a83f53e56df8f1a63757e606b362994b68a2361", "Uniswap v4", 100, "base"),
    StablePool("USDG/syrupUSDG Uniswap v4 5bp", "0xd18c9dc53c12b0db1bc259ff031cd1ac4330ff30a862383904263b6be006bb02", "Uniswap v4", 500, "base", screen_only=True),
]

PANCAKE_MODEL_POOL = Pool(
    "U/USDG Pancake v3 1bp",
    "0x090f2f033c16fe92e28f0204435590548aedc3f0",
    100,
    "USDG",
    "U",
    6,
    18,
    1,
    "base",
    0.0,
)


def get_json(url: str) -> dict:
    for attempt in range(6):
        response = SESSION.get(url, timeout=45)
        if response.ok:
            return response.json()
        time.sleep(2**attempt)
    raise RuntimeError(f"upstream unavailable: {url}")


def pool_metadata(pool: StablePool) -> dict:
    cache = OUT / f"metadata_{pool.address.lower()}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    payload = get_json(f"https://api.geckoterminal.com/api/v2/networks/robinhood/pools/{pool.address}")
    cache.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def raw_candles(pool: StablePool) -> pd.DataFrame:
    cache = OUT / f"candles_{pool.address.lower()}.json"
    if cache.exists():
        rows = json.loads(cache.read_text(encoding="utf-8"))
    else:
        url = (
            f"https://api.geckoterminal.com/api/v2/networks/robinhood/pools/{pool.address}"
            f"/ohlcv/hour?aggregate=1&limit={pool.history_target_hours}&currency=usd&token={pool.gecko_token}"
        )
        rows = get_json(url)["data"]["attributes"]["ohlcv_list"]
        cache.write_text(json.dumps(rows), encoding="utf-8")
    frame = pd.DataFrame(rows, columns=["timestamp", "open", "high", "low", "close", "volume_usd"])
    return frame.sort_values("timestamp").drop_duplicates("timestamp")


def observed_hourly(pool: StablePool) -> pd.DataFrame:
    """Fill inactive hours only inside the pool's actual observed lifespan."""
    frame = raw_candles(pool)
    frame["time"] = pd.to_datetime(frame.timestamp, unit="s", utc=True).dt.floor("h")
    end = frame.time.max()
    start = max(frame.time.min(), end - pd.Timedelta(hours=pool.history_target_hours - 1))
    index = pd.date_range(start=start, end=end, freq="h")
    frame = frame.set_index("time").reindex(index)
    frame["close"] = frame.close.ffill().bfill()
    for column in ["open", "high", "low"]:
        frame[column] = frame[column].fillna(frame.close)
    frame["volume_usd"] = frame.volume_usd.fillna(0.0)
    frame["timestamp"] = (frame.index.astype("int64") // 10**9).astype(int)
    frame["time"] = frame.index
    return frame.reset_index(drop=True)


def pool_stats(pool: StablePool, frame: pd.DataFrame) -> dict:
    attrs = pool_metadata(pool)["data"]["attributes"]
    tvl = float(attrs["reserve_in_usd"])
    median = float(frame.close.median())
    close_dev = (frame.close / median - 1).abs() * 10_000
    intrahour = np.maximum((frame.high / median - 1).abs(), (frame.low / median - 1).abs()) * 10_000
    volume = float(frame.volume_usd.sum())
    fees = volume * pool.fee_ppm / 1_000_000
    return {
        **asdict(pool),
        "tvl_usd": tvl,
        "current_volume_24h_usd": float(attrs["volume_usd"]["h24"]),
        "pool_created_at": attrs["pool_created_at"],
        "observed_hours": int(len(frame)),
        "observed_days": float(len(frame) / 24),
        "from": frame.time.iloc[0].isoformat(),
        "to": frame.time.iloc[-1].isoformat(),
        "observed_volume_usd": volume,
        "annualized_volume_tvl": volume / tvl * (365 * 24 / len(frame)) if tvl else 0.0,
        "full_pool_fee_return_pct": fees / tvl * 100 if tvl else 0.0,
        "annualized_full_pool_fee_apr_pct": fees / tvl * (365 * 24 / len(frame)) * 100 if tvl else 0.0,
        "median_price_usd": median,
        "max_close_deviation_bps": float(close_dev.max()),
        "p99_close_deviation_bps": float(close_dev.quantile(0.99)),
        "p99_intrahour_deviation_bps": float(intrahour.quantile(0.99)),
        "wick_hours_over_500bps": int((intrahour > 500).sum()),
        **{f"close_uptime_within_{band}bps_pct": float((close_dev <= band).mean() * 100) for band in [10, 25, 50, 100, 200]},
    }


def screen_only_stats(pool: StablePool) -> dict:
    """Record current liquidity/volume when a pool is too inactive for candles."""
    attrs = pool_metadata(pool)["data"]["attributes"]
    tvl = float(attrs["reserve_in_usd"])
    current_volume = float(attrs["volume_usd"]["h24"])
    daily_fees = current_volume * pool.fee_ppm / 1_000_000
    return {
        **asdict(pool),
        "tvl_usd": tvl,
        "current_volume_24h_usd": current_volume,
        "pool_created_at": attrs["pool_created_at"],
        "observed_hours": 0,
        "observed_days": 0.0,
        "from": None,
        "to": None,
        "observed_volume_usd": None,
        "annualized_volume_tvl": current_volume / tvl * 365 if tvl else 0.0,
        "full_pool_fee_return_pct": daily_fees / tvl * 100 if tvl else 0.0,
        "annualized_full_pool_fee_apr_pct": daily_fees / tvl * 365 * 100 if tvl else 0.0,
        "median_price_usd": float(attrs["base_token_price_usd"]),
        "max_close_deviation_bps": None,
        "p99_close_deviation_bps": None,
        "p99_intrahour_deviation_bps": None,
        "wick_hours_over_500bps": None,
        **{f"close_uptime_within_{band}bps_pct": None for band in [10, 25, 50, 100, 200]},
    }


def simulate_pancake(frame: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    active = current_active_liquidity(PANCAKE_MODEL_POOL)
    rows = []
    for width in [0.0025, 0.005, 0.01, 0.02, 0.03]:
        for dwell in [1, 6, 24]:
            for cooldown in [24, 72, 168]:
                for compound in [24, 168, 720]:
                    for fee_haircut in [1.0, 0.5, 0.25]:
                        result = simulate(
                            PANCAKE_MODEL_POOL,
                            frame,
                            active,
                            width,
                            dwell,
                            cooldown,
                            compound,
                            fee_haircut,
                        )
                        rows.append({
                            "half_width_bps": int(width * 10_000),
                            "dwell_hours": dwell,
                            "cooldown_hours": cooldown,
                            "compound_hours": compound,
                            "fee_haircut": fee_haircut,
                            **{k: v for k, v in result.items() if k not in {"series", "values"}},
                        })
    grid = pd.DataFrame(rows)
    # Stablecoin safety preference: high uptime, low churn, and no policy that
    # relies on subsidy-era fees to justify repeatedly chasing the peg.
    qualified = grid[(grid.time_in_range_pct >= 98.0) & (grid.rebalances <= 2)]
    if qualified.empty:
        qualified = grid[(grid.time_in_range_pct >= 95.0) & (grid.rebalances <= 3)]
    stress = qualified[qualified.fee_haircut == 0.25].copy()
    stress["score"] = stress.net_return_pct - 0.25 * stress.max_drawdown_pct.abs() - 0.10 * stress.rebalances
    best = stress.sort_values("score", ascending=False).iloc[0].to_dict()
    return grid, best


def main() -> None:
    stats = []
    frames = {}
    for pool in POOLS:
        if pool.screen_only:
            stats.append(screen_only_stats(pool))
            continue
        frame = observed_hourly(pool)
        frames[pool.label] = frame
        stats.append(pool_stats(pool, frame))

    stats_frame = pd.DataFrame(stats)
    stats_frame.to_csv(OUT / "stable_pool_screen.csv", index=False)
    (OUT / "stable_pool_screen.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")

    grid, best = simulate_pancake(frames[PANCAKE_MODEL_POOL.label])
    grid.to_csv(OUT / "u_usdg_pancake_strategy_grid.csv", index=False)
    (OUT / "u_usdg_pancake_best_stress.json").write_text(json.dumps(best, indent=2), encoding="utf-8")

    decision = {
        "status": "WAIT",
        "reason": "Only two independent stablecoin issuers have meaningful active liquidity, and U has less than one month of history.",
        "candidate_pilot_after_gates": {
            "U/USDG Pancake v3": 0.40,
            "USDe/USDG Uniswap v4": 0.30,
            "USDG reserve": 0.30,
        },
        "excluded": {
            "U/USDG Uniswap v4": "same U and USDG issuer exposure; v4 hook/adapter path remains unverified",
            "USDG/syrupUSDG": "material TVL but negligible trading volume",
            "USDC/USDG and USDT/USDG": "insufficient Robinhood Chain liquidity",
        },
        "minimum_additional_evidence": "30 complete post-subsidy days for U pools plus fork-tested v3/v4 adapters and issuer depeg controls",
        "pancake_best_severe_fee_policy": best,
    }
    (OUT / "stable_pilot_decision.json").write_text(json.dumps(decision, indent=2), encoding="utf-8")
    print(stats_frame[["label", "tvl_usd", "observed_days", "observed_volume_usd", "full_pool_fee_return_pct", "p99_close_deviation_bps"]].to_string(index=False))
    print("\nBest U/USDG Pancake severe-fee policy:\n", json.dumps(best, indent=2))


if __name__ == "__main__":
    main()
