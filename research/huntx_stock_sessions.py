"""V3 (0 RPC): stock-token LP flow toxicity by US market session.

Canonical Robinhood stock tokens (public/rh_stocks.json), unhooked V4 pools in
the lean logs. Per swap: LP fee vs 1 h LP markout (mid move against the LP, in
the taker's direction). Swaps at degenerate prices (|tick| >= 700k at either
end) are dropped; single 1 h moves are capped at +/-50%. Sessions are in UTC
(US EDT in September): regular 13:30-20:00, pre-market 08:00-13:30,
after-hours 20:00-24:00, overnight 00:00-08:00, weekend.
"""
import collections, json, os, sys
from datetime import datetime, timezone
import numpy as np
import huntx_launch_l1 as L1

USDG="0x5fc5360d0400a0fd4f2af552add042d716f1d168"; WETH="0x0bd7d308f8e1639fab988df18a8011f41eacad73"; NAT="0x"+"0"*40
HOUR=35_700


def session(t):
    dt = datetime.fromtimestamp(t, timezone.utc)
    m = dt.hour * 60 + dt.minute
    if dt.weekday() >= 5:
        return "weekend"
    if 13 * 60 + 30 <= m < 20 * 60:
        return "regular"
    if 8 * 60 <= m < 13 * 60 + 30:
        return "pre-market"
    if m >= 20 * 60:
        return "after-hours"
    return "overnight"


def load_stock_pools(min_swaps=200):
    stocks = {t["token"].lower(): t["symbol"] for t in json.load(open("../public/rh_stocks.json"))["tokens"]}
    meta = {}
    for d in L1.DIRS:
        if os.path.exists(f"{d}/meta.json"):
            meta.update(json.load(open(f"{d}/meta.json"))["pools"])
    out = {}
    for pid, m in meta.items():
        tok = m["currency1"] if m["currency0"] in (USDG, WETH, NAT) else m["currency0"]
        if tok not in stocks or m["hooks"] != NAT:
            continue
        parts = [np.load(f"{d}/{pid}.npy") for d in L1.DIRS if os.path.exists(f"{d}/{pid}.npy")]
        if not parts:
            continue
        a = np.concatenate(parts)
        _, u = np.unique(a[:, 0] * 1e6 + a[:, 1], return_index=True)
        a = a[np.sort(u)]
        a = a[np.lexsort((a[:, 1], a[:, 0]))]
        if len(a) >= min_swaps:
            out[pid] = (m, stocks[tok], a)
    return out


def main(horizon=HOUR):
    bounds = json.load(open("huntx_edge_activity_screen.json"))["day_bounds"]
    days = sorted(d for d in bounds if "2026-09-01" <= d <= "2026-09-30")
    bb = np.array([bounds[d] for d in days])
    ts = np.array([datetime.fromisoformat(d).replace(tzinfo=timezone.utc).timestamp() for d in days])
    agg = collections.defaultdict(collections.Counter)
    per_sym = collections.defaultdict(collections.Counter)
    pools = load_stock_pools()
    for pid, (m, sym, a) in pools.items():
        quote = USDG if USDG in (m["currency0"], m["currency1"]) else WETH if WETH in (m["currency0"], m["currency1"]) else NAT
        q1 = m["currency1"] == quote
        qamt = a[:, 3] if q1 else a[:, 2]
        tp = a[:, 4] ** 2 if q1 else 1 / a[:, 4] ** 2
        tick = a[:, 6]
        t = np.interp(a[:, 0], bb, ts)
        notional = np.abs(qamt)
        pre = np.concatenate(([tp[0]], tp[:-1]))
        pavg = np.sqrt(pre * tp)
        j = np.clip(np.searchsorted(a[:, 0], a[:, 0] + horizon, side="left") - 1, 0, len(a) - 1)
        move = np.clip(tp[j] / pavg - 1, -0.5, 0.5)
        ok = (np.abs(tick) < 700_000) & (np.abs(tick[j]) < 700_000) & (a[:, 0] + horizon <= a[-1, 0])
        dirn = np.where(qamt < 0, 1.0, -1.0)
        mark = -dirn * notional * move
        fee = notional * a[:, 7] / 1e6
        usd = 1e-6 if quote == USDG else 2600e-18
        for k in np.nonzero(ok)[0]:
            s = session(t[k])
            for c in (agg[s], per_sym[(sym, s)]):
                c["n"] += 1
                c["vol"] += notional[k] * usd
                c["fee"] += fee[k] * usd
                c["mark"] += mark[k] * usd
                c["absmove"] += abs(move[k]) * notional[k] * usd
    res = {"method": __doc__.strip(), "pools": len(pools), "horizon_blocks": horizon, "sessions": {}}
    tot = sum(c["vol"] for c in agg.values())
    for s, c in sorted(agg.items(), key=lambda x: -x[1]["vol"]):
        row = {"swaps": c["n"], "vol_usd": round(c["vol"]), "vol_share": round(c["vol"] / tot, 3),
               "fee_bp": round(c["fee"] / c["vol"] * 1e4, 1), "markout_bp": round(c["mark"] / c["vol"] * 1e4, 1),
               "realized_spread_bp": round((c["fee"] + c["mark"]) / c["vol"] * 1e4, 1),
               "abs_move_bp": round(c["absmove"] / c["vol"] * 1e4, 1)}
        res["sessions"][s] = row
        print(f"{s:12} {row}")
    return res, per_sym


if __name__ == "__main__":
    h = int(sys.argv[1]) if len(sys.argv) > 1 else HOUR
    res, per_sym = main(h)
    json.dump(res, open(f"huntx_stock_sessions_{h}.json", "w"), indent=1)
