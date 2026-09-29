"""Screen established and launch-stage Robinhood Chain LPs for HOODX.

This is a bounded research model. It reads GeckoTerminal's public pool data,
uses 30-day hourly observations where available, and never broadcasts or
interacts with a wallet. Results are descriptive rather than promised yield.
"""

from __future__ import annotations

import json
import math
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import urllib3

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "degen_lp_results"
CACHE = OUT / "cache"
OUT.mkdir(exist_ok=True)
CACHE.mkdir(exist_ok=True)

SESSION = requests.Session()
SESSION.verify = False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
API = "https://api.geckoterminal.com/api/v2"

# The established list is intentionally limited to already-reviewed HOODX
# watchlist identities and direct WETH pools. CASHCAT 30bp is included because
# it is deeper and more active than the route used by the spot-token vault.
ESTABLISHED = [
    ("PONS/WETH 30bp", "0xed50bdeea8adc232f159486192a4157281d722ff", 0.0030, 387_045_669),
    ("AI/WETH 100bp", "0xc4a21f9d6485fc5893dd4a491b320a83daf4da1d", 0.0100, 266_001_490),
    ("CASHCAT/WETH 30bp", "0xd42a491087a15e5afd51feb3606066cc152d2b09", 0.0030, 168_911_905),
    ("CASHCAT/WETH 100bp", "0xa70fc67c9f69da90b63a0e4c05d229954574e313", 0.0100, 168_911_905),
    ("WALLET/WETH 100bp", "0x9501a20bedb8bea0798fe5d4c411f5e270965d49", 0.0100, 50_912_514),
    ("MEME/WETH", "0xe2c12a7379706a291cadaaec1d22458be2f7239d", 0.0030, 26_982_917),
    ("INDEX/WETH", "0xd29893ffac8b29ec4db2cfe0cdb3fe1377c028ff", 0.0030, 23_754_248),
    ("DELTA/WETH", "0xd64fbda67e1015df43fa5e49f02ca844729e5f94", 0.0030, 13_087_698),
]


def cached_get(url: str, key: str, max_age_hours: float = 12) -> dict:
    path = CACHE / f"{key}.json"
    if path.exists():
        age = (time.time() - path.stat().st_mtime) / 3600
        if age <= max_age_hours:
            return json.loads(path.read_text(encoding="utf-8"))
    for attempt in range(7):
        try:
            response = SESSION.get(url, timeout=45)
        except requests.RequestException:
            time.sleep(min(32, 2 ** attempt))
            continue
        if response.ok:
            payload = response.json()
            path.write_text(json.dumps(payload), encoding="utf-8")
            time.sleep(1.1)
            return payload
        if response.status_code == 429:
            time.sleep(min(32, 2 ** attempt))
            continue
        response.raise_for_status()
    raise RuntimeError(f"data source unavailable after bounded retries: {url}")


def hourly_candles(address: str, hours: int = 720) -> pd.DataFrame:
    url = f"{API}/networks/robinhood/pools/{address}/ohlcv/hour?aggregate=1&limit={hours}&currency=usd&token=base"
    payload = cached_get(url, f"ohlcv_{address.lower()}")
    rows = payload["data"]["attributes"]["ohlcv_list"]
    frame = pd.DataFrame(rows, columns=["timestamp", "open", "high", "low", "close", "volume_usd"])
    frame = frame.sort_values("timestamp").drop_duplicates("timestamp")
    frame["time"] = pd.to_datetime(frame.timestamp, unit="s", utc=True).dt.floor("h")
    end = frame.time.max()
    index = pd.date_range(end=end, periods=hours, freq="h")
    frame = frame.set_index("time").reindex(index)
    frame["close"] = frame.close.ffill().bfill()
    for column in ["open", "high", "low"]:
        frame[column] = frame[column].fillna(frame.close)
    frame["volume_usd"] = frame.volume_usd.fillna(0.0)
    frame["time"] = frame.index
    return frame.reset_index(drop=True)


def pool_meta(address: str) -> dict:
    return cached_get(
        f"{API}/networks/robinhood/pools/{address}?include=base_token,quote_token,dex",
        f"pool_{address.lower()}",
    )["data"]


def established_screen() -> pd.DataFrame:
    rows = []
    for label, address, fee, mcap in ESTABLISHED:
        meta = pool_meta(address)
        attr = meta["attributes"]
        frame = hourly_candles(address)
        daily = frame.set_index("time").resample("1D").agg(close=("close", "last"), volume=("volume_usd", "sum"))
        daily = daily.dropna(subset=["close"])
        tvl = float(attr.get("reserve_in_usd") or 0)
        volume_30d = float(frame.volume_usd.sum())
        average_daily = volume_30d / 30
        gross_fee_apr = average_daily * fee * 365 / tvl if tvl else 0
        active_days = int((daily.volume > 0).sum())
        recent = float(daily.volume.tail(7).mean())
        prior = float(daily.volume.iloc[-14:-7].mean()) if len(daily) >= 14 else math.nan
        volume_persistence = recent / prior if prior and not math.isnan(prior) else math.nan
        prices = daily.close.astype(float)
        max_drawdown = float((prices / prices.cummax() - 1).min())
        return_30d = float(prices.iloc[-1] / prices.iloc[0] - 1)
        # Yield is discounted for inactive hours, recent volume deterioration,
        # and execution uncertainty. This is a screen, not a forecast.
        persistence_cap = min(1.0, volume_persistence) if not math.isnan(volume_persistence) else 0.5
        durable_capture = 0.25 * (active_days / 30) * persistence_cap
        modeled_fee_apr = gross_fee_apr * durable_capture
        depth_score = min(1.0, math.log10(max(tvl, 1)) / 7)
        quality_score = (
            0.35 * math.log1p(modeled_fee_apr * 100)
            + 0.25 * depth_score
            + 0.20 * min(1.0, mcap / 100_000_000)
            + 0.20 * min(1.0, active_days / 28)
            + 0.10 * max(-1.0, max_drawdown)
        )
        rows.append({
            "pool": label,
            "address": address,
            "dex": meta["relationships"]["dex"]["data"]["id"],
            "tvl_usd": tvl,
            "market_cap_usd": mcap,
            "volume_30d_usd": volume_30d,
            "active_days": active_days,
            "last7_vs_prior7_volume": volume_persistence,
            "gross_fee_apr_pct": gross_fee_apr * 100,
            "modeled_durable_fee_apr_pct": modeled_fee_apr * 100,
            "price_return_30d_pct": return_30d * 100,
            "price_max_drawdown_30d_pct": max_drawdown * 100,
            "quality_score": quality_score,
        })
    return pd.DataFrame(rows).sort_values("quality_score", ascending=False)


def _token_map(payload: dict) -> dict[str, dict]:
    return {item["id"]: item["attributes"] for item in payload.get("included", []) if item["type"] == "token"}


def launch_screen() -> pd.DataFrame:
    combined: dict[str, tuple[dict, dict]] = {}
    for source in ["new_pools", "trending_pools"]:
        payload = json.loads((ROOT / f"{source}_snapshot.json").read_text(encoding="utf-8"))
        tokens = _token_map(payload)
        for pool in payload["data"]:
            combined[pool["id"]] = (pool, tokens)
    now = datetime.now(timezone.utc)
    rows = []
    for pool, tokens in combined.values():
        attr = pool["attributes"]
        created = datetime.fromisoformat(attr["pool_created_at"].replace("Z", "+00:00"))
        age_hours = max(0.1, (now - created).total_seconds() / 3600)
        tvl = float(attr.get("reserve_in_usd") or 0)
        volume = float(attr.get("volume_usd", {}).get("h24") or 0)
        tx = attr.get("transactions", {}).get("h24", {})
        buyers, sellers = int(tx.get("buyers", 0)), int(tx.get("sellers", 0))
        buys, sells = int(tx.get("buys", 0)), int(tx.get("sells", 0))
        base_id = pool["relationships"]["base_token"]["data"]["id"]
        token = tokens.get(base_id, {})
        # Promotion score rewards two-sided participation and sustainable depth,
        # but deliberately caps turnover so wash volume cannot dominate.
        turnover = volume / tvl if tvl else 0
        breadth = min(buyers, sellers)
        side_balance = min(buys, sells) / max(buys, sells) if max(buys, sells) else 0
        score = (
            0.30 * min(1.0, math.log1p(max(tvl, 0)) / math.log(250_000))
            + 0.25 * min(1.0, breadth / 500)
            + 0.20 * side_balance
            + 0.15 * min(1.0, turnover / 3)
            + 0.10 * min(1.0, age_hours / 48)
        )
        reasons = []
        if tvl < 50_000: reasons.append("depth below $50k")
        if breadth < 150: reasons.append("limited two-sided breadth")
        if side_balance < 0.55: reasons.append("one-sided flow")
        if age_hours < 2: reasons.append("too new")
        rows.append({
            "pool": attr["name"], "address": attr["address"], "symbol": token.get("symbol", "?"),
            "age_hours": age_hours, "tvl_usd": tvl, "volume_24h_usd": volume,
            "turnover_24h": turnover, "buyers_24h": buyers, "sellers_24h": sellers,
            "side_balance": side_balance, "price_change_24h_pct": float(attr.get("price_change_percentage", {}).get("h24") or 0),
            "promotion_score": score, "snapshot_gate": "PASS SNAPSHOT" if not reasons else "; ".join(reasons),
        })
    return pd.DataFrame(rows).sort_values("promotion_score", ascending=False)


def main() -> None:
    established = established_screen()
    established.to_csv(OUT / "established_pool_screen.csv", index=False)
    launch = launch_screen()
    launch.to_csv(OUT / "launch_pool_screen.csv", index=False)
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "established_top": established.head(8).to_dict(orient="records"),
        "launch_snapshot_top": launch.head(12).to_dict(orient="records"),
        "limitations": [
            "Fee APR uses pool volume and headline fee tier; concentrated-liquidity share is not assumed.",
            "Durable fee APR applies a 75% base haircut plus activity and volume-persistence discounts.",
            "Launch candidates have only snapshot evidence; every candidate remains unverified until bytecode, sell, tax, holder, and fork checks pass.",
        ],
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(established[["pool", "tvl_usd", "volume_30d_usd", "gross_fee_apr_pct", "modeled_durable_fee_apr_pct", "price_max_drawdown_30d_pct", "quality_score"]].to_string(index=False))
    print("\nLaunch snapshot\n", launch.head(12).to_string(index=False))


if __name__ == "__main__":
    main()
