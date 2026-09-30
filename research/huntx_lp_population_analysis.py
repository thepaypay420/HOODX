"""What do profitable Robinhood V4 LPs do, and does it persist? (read-only, offline)

Input: huntx_lp_population/episodes.json.gz (every reconstructed LP episode).
Design against survivorship: every episode counts, winners and losers alike.
The month is split at 2026-09-15 00:00 UTC by episode OPEN time:
  * H1-half (opened 09-01..09-14) = discovery; H2-half (09-15..09-29) = test.
Anything "learned" (top owners, best feature bucket) comes only from the
discovery half and is scored only on the test half.
Returns are deposit-weighted: sum(pnl) / sum(deposits). Mid-price marks.
"""

from __future__ import annotations

import gzip
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
POP = ROOT / "huntx_lp_population"
OUT = POP / "analysis.json"
MIN_DEP = 5.0            # ignore dust episodes (< $5 deposited)
MAX_DEP = 1_000_000.0    # no single V4 position here plausibly exceeds $1M; larger = mis-valued
MAX_PRICE_SPAN = 1e12    # drained/manipulated: span >1e12x or price at the V4 tick bound
RET_CAP = (-1.0, 10.0)   # a position cannot lose >100%; +1000% cap limits artifacts in weighted stats


def capped(e, key):
    r = e[key] / e["dep_usd"]
    return max(RET_CAP[0], min(RET_CAP[1], r)) * e["dep_usd"]


def wret(eps, key="pnl_usd"):
    dep = sum(e["dep_usd"] for e in eps)
    return round(sum(capped(e, key) for e in eps) / dep, 5) if dep > 0 else None


def describe(eps):
    if not eps:
        return {"n": 0}
    return {"n": len(eps), "owners": len({e["owner"] for e in eps}), "tokens": len({e["token"] for e in eps}),
            "dep_usd": round(sum(e["dep_usd"] for e in eps)),
            "ret_vs_usd": wret(eps), "ret_vs_hold": wret(eps, "vs_hold_usd"),
            "fee_ret": wret(eps, "fee_usd"),
            "win_rate": round(sum(e["pnl_usd"] > 0 for e in eps) / len(eps), 3),
            "median_ret": round(statistics.median(e["pnl_usd"] / e["dep_usd"] for e in eps), 5)}


def degenerate_pools():
    """Pools whose mid price spans > MAX_PRICE_SPAN within the window (data-quality, outcome-blind)."""
    import numpy as np
    bad = set()
    for d in ("huntx_edge_logs_early", "huntx_edge_logs", "huntx_edge_logs_gap"):
        for f in (ROOT / d).glob("0x*.npy"):
            arr = np.load(f)
            sq, ticks = arr[:, 4], arr[:, 6]
            sq = sq[sq > 0]
            if len(sq) and ((sq.max() / sq.min()) ** 2 > MAX_PRICE_SPAN or np.abs(ticks).max() >= 800_000):
                bad.add(f.stem)
    return bad


def dur_bucket(e):
    b = e["blocks_held"]
    return "same_block_JIT" if b == 0 else "<1h" if b < 35_700 else "1h-1d" if b < 857_000 else \
        "1d-3d" if b < 3 * 857_000 else ">3d"


def width_bucket(e):
    w = e["width"]                         # ln(pb/pa) in price terms
    return "<2%" if w < 0.02 else "2-10%" if w < 0.10 else "10-40%" if w < 0.40 else "40-150%" if w < 1.5 else ">150%"


def side_bucket(e):
    return "quote_only(bid)" if e["one_sided_quote"] else "token_only(ask)" if e["one_sided_token"] else "straddle"


def main():
    eps = json.load(gzip.open(POP / "episodes.json.gz", "rt"))
    bounds = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())["day_bounds"]
    split = bounds["2026-09-15"]
    degenerate = degenerate_pools()
    finite = lambda e: all(math.isfinite(e[k]) for k in ("dep_usd", "wd_usd", "fee_usd", "pnl_usd", "vs_hold_usd"))
    clean = [e for e in eps if not e.get("contaminated") and finite(e) and MIN_DEP <= e["dep_usd"] <= MAX_DEP
             and e["pool_id"] not in degenerate]
    closed = [e for e in clean if e["status"] == "closed"]
    A = [e for e in clean if e["open_block"] < split]
    B = [e for e in clean if e["open_block"] >= split]
    res = {"method": __doc__.strip(), "all_episodes": len(eps), "degenerate_pools_excluded": len(degenerate),
           "excluded_by_sanity": len(eps) - len(clean),
           "contaminated": sum(bool(e.get("contaminated")) for e in eps),
           "population": {"all_clean": describe(clean), "closed": describe(closed),
                          "discovery_half": describe(A), "test_half": describe(B)}}

    # Feature buckets, stable across both halves?
    feats = {"duration": dur_bucket, "width": width_bucket, "side": side_bucket,
             "quote": lambda e: e["quote"][:6], "fee_tier": lambda e: ("<0.3%" if e["fee"] < 3000 else
                                                                       "0.3-1%" if e["fee"] < 10000 else
                                                                       "1-3%" if e["fee"] < 30000 else ">=3%"),
             "sender": lambda e: "PositionManager" if e["sender"].startswith("0x58daec") else "custom_contract"}
    res["features"] = {}
    for name, fn in feats.items():
        tab = {}
        for label in sorted({fn(e) for e in clean}):
            a = [e for e in A if fn(e) == label]
            b = [e for e in B if fn(e) == label]
            tab[label] = {"discovery": describe(a), "test": describe(b)}
        res["features"][name] = tab

    # Owner skill persistence (discovery -> test)
    def owner_stats(group):
        d = defaultdict(list)
        for e in group:
            d[e["owner"]].append(e)
        return d
    oa, ob = owner_stats(A), owner_stats(B)
    both = [o for o in oa if o in ob and len(oa[o]) >= 5 and len(ob[o]) >= 5]
    xa = [wret(oa[o], "vs_hold_usd") for o in both]
    xb = [wret(ob[o], "vs_hold_usd") for o in both]

    def spearman(x, y):
        if len(x) < 5:
            return None
        rx = {i: r for r, i in enumerate(sorted(range(len(x)), key=lambda i: x[i]))}
        ry = {i: r for r, i in enumerate(sorted(range(len(y)), key=lambda i: y[i]))}
        a = [rx[i] for i in range(len(x))]
        b = [ry[i] for i in range(len(y))]
        ma, mb = statistics.mean(a), statistics.mean(b)
        num = sum((p - ma) * (q - mb) for p, q in zip(a, b))
        den = math.sqrt(sum((p - ma) ** 2 for p in a) * sum((q - mb) ** 2 for q in b))
        return round(num / den, 4) if den else None
    ranked = sorted(both, key=lambda o: -wret(oa[o], "vs_hold_usd"))
    top = ranked[: max(1, len(ranked) // 10)]
    bottom = ranked[-max(1, len(ranked) // 10):]
    res["owner_persistence"] = {
        "owners_active_both_halves_ge5": len(both),
        "spearman_vs_hold_discovery_to_test": spearman(xa, xb),
        "spearman_vs_usd_discovery_to_test": spearman([wret(oa[o]) for o in both], [wret(ob[o]) for o in both]),
        "top_decile_discovery": {"owners": len(top), "discovery": describe([e for o in top for e in oa[o]]),
                                 "test": describe([e for o in top for e in ob[o]])},
        "bottom_decile_discovery": {"owners": len(bottom), "test": describe([e for o in bottom for e in ob[o]])},
        "test_population": describe(B),
    }

    # Top owners by discovery PnL (the "profitable users" view), and what they did
    big = sorted(oa.items(), key=lambda kv: -sum(e["pnl_usd"] for e in kv[1]))[:15]
    res["top_discovery_owners"] = [{
        "owner": o, "episodes": len(v), "dep_usd": round(sum(e["dep_usd"] for e in v)),
        "pnl_usd": round(sum(e["pnl_usd"] for e in v), 2), "ret_vs_hold": wret(v, "vs_hold_usd"),
        "median_blocks_held": statistics.median(e["blocks_held"] for e in v),
        "median_width": round(statistics.median(e["width"] for e in v), 4),
        "sides": {s: sum(side_bucket(e) == s for e in v) for s in ("quote_only(bid)", "token_only(ask)", "straddle")},
        "pools": len({e["pool_id"] for e in v}),
        "test_half": describe(ob.get(o, [])),
    } for o, v in big]
    # H7: Krystal-vault-owned positions (RAPTOR-X-style agents etc.), judged on-chain
    snap = json.loads((ROOT / "huntx_krystal_rh_vaults_snapshot.json").read_text())["vaults"]
    kv = {v["vaultAddress"].lower(): v["name"] for v in snap}
    is_k = lambda e: e["owner"] in kv or e["sender"] in kv
    res["H7_krystal_vaults"] = {
        "vault_addresses": len(kv),
        "vaults_seen_onchain": len({e["owner"] for e in clean if is_k(e)} | {e["sender"] for e in clean if is_k(e)}),
        "discovery": {"krystal": describe([e for e in A if is_k(e)]), "others": describe([e for e in A if not is_k(e)])},
        "test": {"krystal": describe([e for e in B if is_k(e)]), "others": describe([e for e in B if not is_k(e)])},
        "by_vault_test_half": sorted(({"vault": kv.get(o, o), "addr": o, **describe(v)} for o, v in
                                      defaultdict(list, {o: [e for e in B if e["owner"] == o] for o in kv}).items() if v),
                                     key=lambda r: -(r.get("dep_usd") or 0))[:15],
    }
    OUT.write_text(json.dumps(res, indent=1, default=str))
    print("\nH7 Krystal vaults:", json.dumps({k: res["H7_krystal_vaults"][k] for k in ("vault_addresses", "vaults_seen_onchain", "discovery", "test")}, indent=1))
    print(json.dumps({"population": res["population"], "owner_persistence": res["owner_persistence"]}, indent=1))
    for name, tab in res["features"].items():
        print("\n==", name)
        for label, v in tab.items():
            d, t = v["discovery"], v["test"]
            print(f"  {label:18} disc n={d.get('n',0):6} vsUSD={d.get('ret_vs_usd')} vsHold={d.get('ret_vs_hold')} | "
                  f"test n={t.get('n',0):6} vsUSD={t.get('ret_vs_usd')} vsHold={t.get('ret_vs_hold')}")


if __name__ == "__main__":
    main()
