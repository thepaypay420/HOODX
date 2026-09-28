"""Robinhood Chain LP range/cadence study.

Uses hourly GeckoTerminal candles and volume, exact on-chain v3 pool metadata,
and a transparent small-position fee-share approximation based on current active
liquidity. This is a research model, not executable trade advice.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import urllib3
from web3 import Web3

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "lp_month_results"
OUT.mkdir(exist_ok=True)

RPC = "https://rpc.mainnet.chain.robinhood.com"
CAPITAL = 10_000.0
Q96 = 2**96
FEE_REALITY_HAIRCUT = 0.50
FEE_STRESS_HAIRCUT = 0.25
COMPOUND_FIXED_COST_USD = 0.25
COMPOUND_RATIO_COST = 0.0005
REBAND_FIXED_COST_USD = 0.75
REBAND_SWAP_COST = 0.0010

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
SESSION = requests.Session()
SESSION.verify = False
W3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 45}, session=SESSION))

POOL_ABI = [
    {"type": "function", "name": "liquidity", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint128"}]},
    {"type": "function", "name": "slot0", "stateMutability": "view", "inputs": [], "outputs": [
        {"type": "uint160"}, {"type": "int24"}, {"type": "uint16"}, {"type": "uint16"},
        {"type": "uint16"}, {"type": "uint8"}, {"type": "bool"}
    ]},
]


@dataclass(frozen=True)
class Pool:
    label: str
    address: str
    fee: int
    token0: str
    token1: str
    decimals0: int
    decimals1: int
    asset_token: int
    gecko_token: str
    tvl_usd: float


POOLS = [
    Pool("WETH/USDG 1bp", "0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca", 100,
         "WETH", "USDG", 18, 6, 0, "quote", 19_871_216.50),
    Pool("WETH/USDG 5bp", "0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a", 500,
         "WETH", "USDG", 18, 6, 0, "quote", 5_664_485.49),
    Pool("NVDA/USDG 5bp", "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", 500,
         "USDG", "NVDA", 6, 18, 1, "base", 5_197_582.95),
    Pool("GLD/USDG 5bp", "0xBA2f1ed4cEB2169D538d1e614D847E83C5A55913", 500,
         "USDG", "GLD", 6, 18, 1, "base", 1_506_070.46),
    Pool("GLD/USDG 30bp", "0x7A6A053eCCf1446A2633E05aA6D40D09381997ec", 3000,
         "USDG", "GLD", 6, 18, 1, "base", 3_045_963.86),
    Pool("QQQ/USDG 5bp", "0xD60A5d14dB690B7Afad71F76B108071D7175597d", 500,
         "USDG", "QQQ", 6, 18, 1, "base", 1_333_996.06),
    Pool("AAPL/USDG 5bp", "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D", 500,
         "USDG", "AAPL", 6, 18, 1, "base", 339_798.12),
    Pool("SPY/USDG 5bp", "0xa7Bb1AC63BBaB0C44316E6c8C455213441689167", 500,
         "SPY", "USDG", 18, 6, 0, "base", 368_382.23),
    Pool("AMZN/USDG 30bp", "0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef", 3000,
         "AMZN", "USDG", 18, 6, 0, "base", 847_421.02),
]

STABLE_CANDIDATE = {
    "label": "USDe/USDG 1bp v4",
    "pool_id": "0xa5f23cae4e5c3388c5a8a6b08a83f53e56df8f1a63757e606b362994b68a2361",
    "fee": 100,
    "tvl_usd": 998_168.61,
}

WIDTHS = [0.05, 0.10, 0.15, 0.25, 0.40]
DWELLS = [1, 4, 12]
COOLDOWNS = [12, 24, 72]
COMPOUND_HOURS = [24, 72, 168]

# Scalable, deliberately simple pilot. The range choices are the broadest
# near-optimal policies that avoided churn in the observed month. Reserve is
# kept outside LP positions so exits and maintenance never depend on a swap.
RECOMMENDED_PILOT = {
    "WETH/USDG 1bp": {
        "weight": 0.55, "half_width_pct": 10.0, "dwell_hours": 12,
        "cooldown_hours": 72, "compound_hours": 72,
    },
    "NVDA/USDG 5bp": {
        "weight": 0.20, "half_width_pct": 10.0, "dwell_hours": 4,
        "cooldown_hours": 24, "compound_hours": 168,
    },
    "QQQ/USDG 5bp": {
        "weight": 0.10, "half_width_pct": 10.0, "dwell_hours": 4,
        "cooldown_hours": 24, "compound_hours": 168,
    },
}
RESERVE_WEIGHT = 0.15


def candles(pool: Pool, hours: int = 720) -> pd.DataFrame:
    cache = OUT / f"candles_{pool.address.lower()}.json"
    if cache.exists():
        rows = json.loads(cache.read_text(encoding="utf-8"))
    else:
        url = (
            f"https://api.geckoterminal.com/api/v2/networks/robinhood/pools/{pool.address}"
            f"/ohlcv/hour?aggregate=1&limit={hours}&currency=usd&token={pool.gecko_token}"
        )
        payload = None
        for attempt in range(6):
            response = SESSION.get(url, timeout=45)
            if response.ok and "data" in response.json():
                payload = response.json()
                break
            time.sleep(2 ** attempt)
        if payload is None:
            raise RuntimeError(f"GeckoTerminal candles unavailable for {pool.label}")
        rows = payload["data"]["attributes"]["ohlcv_list"]
        cache.write_text(json.dumps(rows), encoding="utf-8")
    df = pd.DataFrame(rows, columns=["timestamp", "open", "high", "low", "close", "volume_usd"])
    return normalize_hourly(df, hours)


def normalize_hourly(df: pd.DataFrame, hours: int = 720) -> pd.DataFrame:
    """Create a true 30-day hourly grid; Gecko omits hours with no swaps."""
    df = df.sort_values("timestamp").drop_duplicates("timestamp")
    df["time"] = pd.to_datetime(df.timestamp, unit="s", utc=True).dt.floor("h")
    end = df.time.max()
    index = pd.date_range(end=end, periods=hours, freq="h")
    df = df.set_index("time").reindex(index)
    df["close"] = df.close.ffill().bfill()
    for column in ["open", "high", "low"]:
        df[column] = df[column].fillna(df.close)
    df["volume_usd"] = df.volume_usd.fillna(0.0)
    df["timestamp"] = (df.index.astype("int64") // 10**9).astype(int)
    df["time"] = df.index
    return df.reset_index(drop=True)


def raw_sqrt_from_asset_price(pool: Pool, asset_price_usd: float) -> float:
    # Human token1/token0, then convert to raw-unit token1/token0.
    human_ratio = asset_price_usd if pool.asset_token == 0 else 1.0 / asset_price_usd
    raw_ratio = human_ratio * 10 ** (pool.decimals1 - pool.decimals0)
    return math.sqrt(raw_ratio)


def token_prices(pool: Pool, asset_price: float) -> tuple[float, float]:
    return (asset_price, 1.0) if pool.asset_token == 0 else (1.0, asset_price)


def amounts_per_liquidity(sqrt_price: float, sqrt_lower: float, sqrt_upper: float) -> tuple[float, float]:
    if sqrt_price <= sqrt_lower:
        return (sqrt_upper - sqrt_lower) / (sqrt_lower * sqrt_upper), 0.0
    if sqrt_price >= sqrt_upper:
        return 0.0, sqrt_upper - sqrt_lower
    return ((sqrt_upper - sqrt_price) / (sqrt_price * sqrt_upper), sqrt_price - sqrt_lower)


def value_per_liquidity(pool: Pool, asset_price: float, lower: float, upper: float) -> float:
    s = raw_sqrt_from_asset_price(pool, asset_price)
    sl = raw_sqrt_from_asset_price(pool, lower)
    su = raw_sqrt_from_asset_price(pool, upper)
    if sl > su:
        sl, su = su, sl
    a0, a1 = amounts_per_liquidity(s, sl, su)
    p0, p1 = token_prices(pool, asset_price)
    return a0 / 10**pool.decimals0 * p0 + a1 / 10**pool.decimals1 * p1


def position_value(pool: Pool, liquidity: float, asset_price: float, lower: float, upper: float) -> float:
    return liquidity * value_per_liquidity(pool, asset_price, lower, upper)


def centered(price: float, half_width: float) -> tuple[float, float]:
    # Geometric symmetry avoids directional bias.
    return price / (1 + half_width), price * (1 + half_width)


def current_active_liquidity(pool: Pool) -> int:
    contract = W3.eth.contract(address=Web3.to_checksum_address(pool.address), abi=POOL_ABI)
    return contract.functions.liquidity().call()


def simulate(
    pool: Pool,
    df: pd.DataFrame,
    active_liquidity: int,
    half_width: float,
    dwell_hours: int,
    cooldown_hours: int,
    compound_hours: int,
    fee_haircut: float,
    capital_usd: float = CAPITAL,
) -> dict:
    start_price = float(df.iloc[0].close)
    lower, upper = centered(start_price, half_width)
    vpl = value_per_liquidity(pool, start_price, lower, upper)
    liquidity = capital_usd / vpl
    initial_liquidity = liquidity
    fees_idle = 0.0
    rebalances = 0
    compounds = 0
    edge_count = 0
    last_reband = -10**9
    last_compound = 0
    in_range_hours = 0
    values: list[float] = []
    fee_total = 0.0
    costs_total = 0.0

    # Initial token mix for a passive HODL benchmark.
    s0 = raw_sqrt_from_asset_price(pool, start_price)
    sl0 = raw_sqrt_from_asset_price(pool, lower)
    su0 = raw_sqrt_from_asset_price(pool, upper)
    if sl0 > su0:
        sl0, su0 = su0, sl0
    init0_per_l, init1_per_l = amounts_per_liquidity(s0, sl0, su0)
    init0, init1 = liquidity * init0_per_l / 10**pool.decimals0, liquidity * init1_per_l / 10**pool.decimals1

    for i, row in df.iterrows():
        price = float(row.close)
        inside = lower <= price <= upper
        if inside:
            in_range_hours += 1
            share = liquidity / (active_liquidity + liquidity)
            earned = float(row.volume_usd) * pool.fee / 1_000_000 * share * fee_haircut
            fees_idle += earned
            fee_total += earned

        # Reinvest on a fixed maximum interval only when enough fees cover costs 4x.
        if inside and i - last_compound >= compound_hours and fees_idle >= 4 * COMPOUND_FIXED_COST_USD:
            cost = COMPOUND_FIXED_COST_USD + fees_idle * COMPOUND_RATIO_COST
            deployable = max(0.0, fees_idle - cost)
            liquidity += deployable / value_per_liquidity(pool, price, lower, upper)
            costs_total += cost
            fees_idle = 0.0
            compounds += 1
            last_compound = i

        # Trigger within the outer 15% of either side; require persistence and cooldown.
        edge_low = lower + (upper - lower) * 0.15
        edge_high = upper - (upper - lower) * 0.15
        at_edge = price <= edge_low or price >= edge_high
        edge_count = edge_count + 1 if at_edge else 0
        if at_edge and edge_count >= dwell_hours and i - last_reband >= cooldown_hours:
            gross = position_value(pool, liquidity, price, lower, upper) + fees_idle
            cost = REBAND_FIXED_COST_USD + gross * REBAND_SWAP_COST
            net = max(0.0, gross - cost)
            lower, upper = centered(price, half_width)
            liquidity = net / value_per_liquidity(pool, price, lower, upper)
            fees_idle = 0.0
            costs_total += cost
            rebalances += 1
            last_reband = i
            edge_count = 0

        values.append(position_value(pool, liquidity, price, lower, upper) + fees_idle)

    end_price = float(df.iloc[-1].close)
    final_value = values[-1]
    p0, p1 = token_prices(pool, end_price)
    hodl_final = init0 * p0 + init1 * p1
    series = pd.Series(values)
    drawdown = (series / series.cummax() - 1).min()
    daily = series.iloc[::24].pct_change().dropna()
    annual_vol = float(daily.std(ddof=0) * math.sqrt(365)) if len(daily) > 1 else 0.0
    return {
        "pool": pool.label,
        "address": pool.address,
        "hours": len(df),
        "half_width_pct": half_width * 100,
        "dwell_hours": dwell_hours,
        "cooldown_hours": cooldown_hours,
        "compound_hours": compound_hours,
        "fee_haircut_pct": (1 - fee_haircut) * 100,
        "start_price": start_price,
        "end_price": end_price,
        "volume_usd": float(df.volume_usd.sum()),
        "fees_to_position_usd": fee_total,
        "costs_usd": costs_total,
        "capital_usd": capital_usd,
        "net_return_pct": (final_value / capital_usd - 1) * 100,
        "hodl_return_pct": (hodl_final / capital_usd - 1) * 100,
        "excess_vs_hodl_pct": (final_value / hodl_final - 1) * 100,
        "max_drawdown_pct": drawdown * 100,
        "annualized_vol_pct": annual_vol * 100,
        "time_in_range_pct": in_range_hours / len(df) * 100,
        "rebalances": rebalances,
        "compounds": compounds,
        "initial_liquidity_share_pct": initial_liquidity / (active_liquidity + initial_liquidity) * 100,
        "values": values,
    }


def main() -> None:
    all_rows = []
    series_by_key: dict[str, list[float]] = {}
    snapshots = []
    for pool in POOLS:
        df = candles(pool)
        active = current_active_liquidity(pool)
        snapshots.append({**asdict(pool), "active_liquidity": str(active), "hours": len(df),
                          "from": df.iloc[0].time.isoformat(), "to": df.iloc[-1].time.isoformat(),
                          "volume_30d_usd": float(df.volume_usd.sum())})
        for width in WIDTHS:
            for dwell in DWELLS:
                for cooldown in COOLDOWNS:
                    for compound in COMPOUND_HOURS:
                        for fee_haircut in [1.0, FEE_REALITY_HAIRCUT, FEE_STRESS_HAIRCUT]:
                            row = simulate(pool, df, active, width, dwell, cooldown, compound, fee_haircut)
                            key = "|".join(str(row[k]) for k in ["pool", "half_width_pct", "dwell_hours", "cooldown_hours", "compound_hours", "fee_haircut_pct"])
                            series_by_key[key] = row.pop("values")
                            all_rows.append(row)
        time.sleep(0.3)

    results = pd.DataFrame(all_rows)
    results.to_csv(OUT / "strategy_grid.csv", index=False)
    (OUT / "pool_snapshots.json").write_text(json.dumps(snapshots, indent=2), encoding="utf-8")

    conservative = results[
        (results.fee_haircut_pct == 50)
        & (results.time_in_range_pct >= 85)
        & (results.rebalances <= 6)
    ].copy()
    conservative["risk_score"] = (
        conservative.net_return_pct
        + 0.45 * conservative.excess_vs_hodl_pct
        + 0.20 * conservative.max_drawdown_pct
        - 0.02 * conservative.annualized_vol_pct
        - 0.08 * conservative.rebalances
    )
    best = conservative.sort_values(["pool", "risk_score"], ascending=[True, False]).groupby("pool").head(1)
    best.to_csv(OUT / "best_by_pool.csv", index=False)

    # Save aligned conservative value series for the selected strategies.
    chosen_series = {}
    for _, row in best.iterrows():
        key = "|".join(str(row[k]) for k in ["pool", "half_width_pct", "dwell_hours", "cooldown_hours", "compound_hours", "fee_haircut_pct"])
        chosen_series[row.pool] = series_by_key[key]
    pd.DataFrame({k: pd.Series(v) for k, v in chosen_series.items()}).to_csv(OUT / "selected_value_series.csv", index=False)

    # Evaluate one fixed management policy under both a 50% fee haircut and a
    # severe 75% haircut. This prevents the recommendation from cherry-picking
    # a different range after seeing each stress case.
    pilot_report = {
        "capital_usd": CAPITAL,
        "reserve_weight_pct": RESERVE_WEIGHT * 100,
        "sleeves": RECOMMENDED_PILOT,
        "cases": {},
    }
    pilot_series = {}
    for fee_multiplier, case_name in [(FEE_REALITY_HAIRCUT, "50pct_fee_haircut"),
                                      (FEE_STRESS_HAIRCUT, "75pct_fee_haircut")]:
        combined = np.full(720, CAPITAL * RESERVE_WEIGHT, dtype=float)
        passive_final = CAPITAL * RESERVE_WEIGHT
        sleeve_rows = []
        for pool_name, policy in RECOMMENDED_PILOT.items():
            row = results[
                (results.pool == pool_name)
                & (results.half_width_pct == policy["half_width_pct"])
                & (results.dwell_hours == policy["dwell_hours"])
                & (results.cooldown_hours == policy["cooldown_hours"])
                & (results.compound_hours == policy["compound_hours"])
                & (results.fee_haircut_pct == (1 - fee_multiplier) * 100)
            ].iloc[0]
            key = "|".join(str(row[k]) for k in ["pool", "half_width_pct", "dwell_hours",
                                                   "cooldown_hours", "compound_hours", "fee_haircut_pct"])
            sleeve_values = np.asarray(series_by_key[key], dtype=float)
            combined += sleeve_values * policy["weight"]
            passive_final += CAPITAL * policy["weight"] * (1 + float(row.hodl_return_pct) / 100)
            sleeve_rows.append({
                "pool": pool_name,
                "weight_pct": policy["weight"] * 100,
                "net_return_pct": float(row.net_return_pct),
                "max_drawdown_pct": float(row.max_drawdown_pct),
                "time_in_range_pct": float(row.time_in_range_pct),
                "rebalances": int(row.rebalances),
                "compounds": int(row.compounds),
            })
        values = pd.Series(combined)
        drawdown = float((values / values.cummax() - 1).min() * 100)
        daily = values.iloc[::24].pct_change().dropna()
        case = {
            "net_return_pct": float((values.iloc[-1] / CAPITAL - 1) * 100),
            "passive_starting_mix_return_pct": float((passive_final / CAPITAL - 1) * 100),
            "excess_vs_passive_pct": float((values.iloc[-1] / passive_final - 1) * 100),
            "max_drawdown_pct": drawdown,
            "annualized_vol_pct": float(daily.std(ddof=0) * math.sqrt(365) * 100),
            "worst_day_pct": float(daily.min() * 100),
            "sleeves": sleeve_rows,
        }
        pilot_report["cases"][case_name] = case
        pilot_series[case_name] = combined
    (OUT / "recommended_pilot.json").write_text(json.dumps(pilot_report, indent=2), encoding="utf-8")
    pd.DataFrame(pilot_series).to_csv(OUT / "recommended_pilot_series.csv", index=False)

    # Stable/stable v4 candidate: report observed peg behavior and conservative
    # full-pool pro-rata fees. We intentionally do not invent v4 tick-level fee
    # attribution without historical liquidity-distribution data.
    stable_cache = OUT / f"candles_{STABLE_CANDIDATE['pool_id']}.json"
    if stable_cache.exists():
        stable_rows = json.loads(stable_cache.read_text(encoding="utf-8"))
    else:
        stable_url = (
            "https://api.geckoterminal.com/api/v2/networks/robinhood/pools/"
            f"{STABLE_CANDIDATE['pool_id']}/ohlcv/hour?aggregate=1&limit=720&currency=usd&token=base"
        )
        stable_rows = SESSION.get(stable_url, timeout=45).json()["data"]["attributes"]["ohlcv_list"]
        stable_cache.write_text(json.dumps(stable_rows), encoding="utf-8")
    stable = normalize_hourly(
        pd.DataFrame(stable_rows, columns=["timestamp", "open", "high", "low", "close", "volume_usd"])
    )
    intrahour_deviation_bps = np.maximum((stable.high - 1).abs(), (stable.low - 1).abs()) * 10_000
    close_deviation_bps = (stable.close - 1).abs() * 10_000
    stable_report = {
        **STABLE_CANDIDATE,
        "hours": len(stable),
        "from": datetime.fromtimestamp(int(stable.iloc[0].timestamp), timezone.utc).isoformat(),
        "to": datetime.fromtimestamp(int(stable.iloc[-1].timestamp), timezone.utc).isoformat(),
        "volume_30d_usd": float(stable.volume_usd.sum()),
        "median_price": float(stable.close.median()),
        "max_close_deviation_bps": float(close_deviation_bps.max()),
        "p99_close_deviation_bps": float(close_deviation_bps.quantile(0.99)),
        "p99_intrahour_deviation_bps": float(intrahour_deviation_bps.quantile(0.99)),
        "anomalous_wick_hours_over_500bps": int((intrahour_deviation_bps > 500).sum()),
        "full_pool_fee_return_pct": float(
            stable.volume_usd.sum() * STABLE_CANDIDATE["fee"] / 1_000_000
            * (CAPITAL / STABLE_CANDIDATE["tvl_usd"]) / CAPITAL * 100
        ),
    }
    for bps in [25, 50, 100, 200]:
        stable_report[f"close_uptime_within_{bps}bps_pct"] = float(((stable.close - 1).abs() <= bps / 10_000).mean() * 100)
    (OUT / "stable_candidate.json").write_text(json.dumps(stable_report, indent=2), encoding="utf-8")

    print(best[["pool", "half_width_pct", "dwell_hours", "cooldown_hours", "compound_hours",
                "net_return_pct", "hodl_return_pct", "excess_vs_hodl_pct", "max_drawdown_pct",
                "time_in_range_pct", "rebalances", "compounds", "volume_usd", "risk_score"]]
          .sort_values("risk_score", ascending=False).to_string(index=False))
    print("\nStable candidate\n", json.dumps(stable_report, indent=2))
    print("\nRecommended pilot\n", json.dumps(pilot_report, indent=2))


if __name__ == "__main__":
    main()
