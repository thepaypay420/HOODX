"""Reconstruct every V4 LP position on the lean pools (2026-09-01..09-29).

Position = (pool, sender, tickLower, tickUpper, salt). For PositionManager
positions the salt is the NFT id and the owner is the NFT holder at mint.
An *episode* runs from liquidity 0 -> >0 until it returns to 0 (closed) or the
data window ends (open, marked at the last in-coverage mid price).

Per episode: deposits and withdrawals are valued at the pool's price at that
log. Fees use the validated V4 convention (negative amount = input, minus
protocol fee), counted only while the log-price path is in range, with this
position's share = L / active L (it is already inside active L). Pool-level
event fees are calibrated to on-chain feeGrowthGlobal over the window, and pools
outside [0.85, 1.15] are flagged UNVERIFIED. Outputs PnL vs USD and vs
holding the deposited tokens. Mid-price valuation: realized executable exits
are NOT modelled here; this is a population description, not a strategy result.
"""

from __future__ import annotations

import bisect
import gzip
import json
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path

import numpy as np

from huntx_edge_chain import Q128, USDG, WETH
from huntx_edge_engine import amounts, value_in_quote

ROOT = Path(__file__).parent
POP = ROOT / "huntx_lp_population"
LOGDIRS = ["huntx_edge_logs_early", "huntx_edge_logs", "huntx_edge_logs_gap"]
OUT = POP / "episodes.json.gz"
NATIVE = "0x" + "0" * 40
POSM = "0x58daec3116aae6d93017baaea7749052e8a04fa7"
LN = math.log(1.0001)


def sqrt_t(t):
    return math.exp(t * LN / 2)


class Series:
    def __init__(self, pid, meta, arr):
        self.pid, self.meta = pid, meta
        self.key = arr[:, 0] * 100_000 + arr[:, 1]          # (block, logIndex) order key
        self.a0, self.a1, self.sq, self.liq, self.fee = arr[:, 2], arr[:, 3], arr[:, 4], arr[:, 5], arr[:, 7]
        c0, c1 = meta["currency0"], meta["currency1"]
        self.quote = USDG if USDG in (c0, c1) else WETH if WETH in (c0, c1) else NATIVE
        self.q1 = c1 == self.quote
        self.token = c0 if self.q1 else c1
        self.qdec = 6 if self.quote == USDG else 18
        self.first_key, self.last_key = (self.key[0], self.key[-1]) if len(self.key) else (None, None)

    def idx(self, k):
        return int(np.searchsorted(self.key, k, side="left"))

    def sqrt_at(self, k):
        i = self.idx(k)
        return None if i == 0 else float(self.sq[i - 1])

    def fees(self, k0, k1, sa, sb, L, proto0, proto1, start_sqrt):
        i0, i1 = self.idx(k0), self.idx(k1)
        if i1 <= i0 or L <= 0:
            return 0.0, 0.0
        cur = np.log(self.sq[i0:i1])
        prev = np.concatenate(([math.log(start_sqrt)], cur[:-1]))
        la, lb = math.log(sa), math.log(sb)
        lo, hi = np.minimum(prev, cur), np.maximum(prev, cur)
        span = hi - lo
        point = ((lo >= la) & (lo <= lb)).astype(float)
        frac = np.where(span < 1e-15, point,
                        np.clip(np.minimum(hi, lb) - np.maximum(lo, la), 0, None) / np.where(span < 1e-15, 1, span))
        a0, a1, liq, fee = self.a0[i0:i1], self.a1[i0:i1], self.liq[i0:i1], self.fee[i0:i1]
        zin = a0 < 0
        gross = np.where(zin, -a0, -a1)
        lp = np.where((gross > 0) & (liq > 0), gross * np.maximum(fee - np.where(zin, proto0, proto1), 0) / 1e6, 0.0)
        share = np.minimum(L / np.where(liq > 0, liq, np.inf), 1.0)
        ours = lp * share * frac
        return float(ours[zin].sum()), float(ours[~zin].sum())


def load_series():
    metas, parts = {}, defaultdict(list)
    for d in LOGDIRS:
        m = json.loads((ROOT / d / "meta.json").read_text())
        for pid, meta in m["pools"].items():
            f = ROOT / d / f"{pid}.npy"
            if f.exists():
                metas.setdefault(pid, meta)
                parts[pid].append(np.load(f))
    out = {}
    for pid, arrs in parts.items():
        arr = np.concatenate(arrs)
        _, first = np.unique(arr[:, 0] * 1e6 + arr[:, 1], return_index=True)
        arr = arr[np.sort(first)]
        arr = arr[np.lexsort((arr[:, 1], arr[:, 0]))]
        out[pid] = Series(pid, metas[pid], arr)
    return out


def main():
    state = json.load(gzip.open(ROOT / "huntx_edge_state_panel.json.gz", "rt"))
    bounds = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())["day_bounds"]
    series = load_series()
    mods = json.load(gzip.open(POP / "modify.json.gz", "rt"))["rows"]
    xfers = json.load(gzip.open(POP / "posm_transfers.json.gz", "rt"))["rows"]
    owner_at_mint = {}
    for blk, li, frm, to, tid, tx in xfers:
        if frm == NATIVE:
            owner_at_mint[tid] = to
    # ETH/USD from the reference ETH/USDG pool
    ref = next(s for pid, s in series.items() if pid.startswith("0x24107d152f"))

    def eth_usd(k):
        s = ref.sqrt_at(k)
        return (s * s if ref.q1 else 1 / (s * s)) * 1e12 if s else None

    # Pool-level calibration + protocol fee (nearest state read; small effect)
    def proto(pid, blk):
        recs = state["state"].get(pid, {})
        days = sorted(d for d, r in recs.items() if "proto" in r and bounds[d] - 1 <= blk)
        if not days:
            days = sorted(d for d, r in recs.items() if "proto" in r)[:1]
        p = recs[days[-1]]["proto"] if days else 0
        return p & 0xFFF, p >> 12

    by_pos = defaultdict(list)
    for r in mods:
        blk, li, pid, sender, tl, tu, dl, salt, tx = r
        if pid in series:
            by_pos[(pid, sender, tl, tu, salt)].append((blk, li, int(dl), tx))
    episodes = []
    for (pid, sender, tl, tu, salt), evs in by_pos.items():
        s = series[pid]
        sa, sb = sqrt_t(tl), sqrt_t(tu)
        L = 0.0
        ep = None
        for blk, li, dl, tx in evs:
            k = blk * 100_000 + li
            outside = s.first_key is None or k < s.first_key or k > s.last_key
            pre_window = dl < 0 and -dl > L * (1 + 1e-9) + 1        # removes more than we saw added
            if outside or pre_window:
                if ep is not None:
                    ep["contaminated"] = "outside_swap_coverage" if outside else "pre_window_liquidity"
                L = max(0.0, L + dl)
                if L == 0 and ep is not None:
                    ep["close_block"], ep["status"] = blk, "contaminated"
                    ep["hold_usd_at_close"] = 0.0
                    episodes.append(ep)
                    ep = None
                continue
            sq = s.sqrt_at(k) or float(s.sq[0])
            eth = eth_usd(k) or 0.0
            to_usd = (lambda x: x / 1e6) if s.quote == USDG else (lambda x: x / 1e18 * eth)
            if dl > 0 and L == 0:
                tid = int(salt, 16) if sender == POSM else None
                ep = {"pool_id": pid, "sender": sender, "owner": owner_at_mint.get(tid, sender) if tid else sender,
                      "token_id": tid, "tick_lower": tl, "tick_upper": tu, "quote": s.quote, "token": s.token,
                      "fee": s.meta["fee"], "open_block": blk, "open_tx": tx, "events": 0,
                      "dep_usd": 0.0, "wd_usd": 0.0, "fee_usd": 0.0, "hold_tok": 0.0, "hold_q": 0.0,
                      "entry_sqrt": sq, "width": (tu - tl) * LN,
                      "one_sided_quote": (sq <= sa) if not s.q1 else (sq >= sb),
                      "one_sided_token": (sq >= sb) if not s.q1 else (sq <= sa),
                      "last_k": k}
            if ep is None:                                  # liquidity from before the window
                L = max(0.0, L + dl)
                continue
            # fees accrued on the current L since the last event
            p0, p1 = proto(pid, blk)
            f0, f1 = s.fees(ep["last_k"], k, sa, sb, L, p0, p1, s.sqrt_at(ep["last_k"]) or sq)
            ep["fee_usd"] += to_usd(value_in_quote(f0, f1, sq, s.q1))
            a0, a1 = amounts(abs(dl), sq, sa, sb)
            v = to_usd(value_in_quote(a0, a1, sq, s.q1))
            tok, q = (a0, a1) if s.q1 else (a1, a0)
            if dl > 0:
                ep["dep_usd"] += v
                ep["hold_tok"] += tok
                ep["hold_q"] += q
            else:
                ep["wd_usd"] += v
            ep["events"] += 1
            ep["last_k"] = k
            L = max(0.0, L + dl)
            if L == 0:
                ep["close_block"] = blk
                ep["status"] = "closed"
                ep["hold_usd_at_close"] = to_usd(value_in_quote(*((ep["hold_tok"], ep["hold_q"]) if s.q1 else
                                                                  (ep["hold_q"], ep["hold_tok"])), sq, s.q1))
                episodes.append(ep)
                ep = None
        if ep is not None and L > 0:                       # open at window end: mark at last mid
            k_end = s.last_key
            sq = float(s.sq[-1])
            eth = eth_usd(k_end) or 0.0
            to_usd = (lambda x: x / 1e6) if s.quote == USDG else (lambda x: x / 1e18 * eth)
            p0, p1 = proto(pid, int(k_end // 100_000))
            f0, f1 = s.fees(ep["last_k"], k_end + 1, sa, sb, L, p0, p1, s.sqrt_at(ep["last_k"]) or sq)
            ep["fee_usd"] += to_usd(value_in_quote(f0, f1, sq, s.q1))
            a0, a1 = amounts(L, sq, sa, sb)
            ep["wd_usd"] += to_usd(value_in_quote(a0, a1, sq, s.q1))
            ep["close_block"] = int(k_end // 100_000)
            ep["status"] = "open_marked"
            ep["hold_usd_at_close"] = to_usd(value_in_quote(*((ep["hold_tok"], ep["hold_q"]) if s.q1 else
                                                              (ep["hold_q"], ep["hold_tok"])), sq, s.q1))
            episodes.append(ep)
    for ep in episodes:
        ep["pnl_usd"] = ep["wd_usd"] + ep["fee_usd"] - ep["dep_usd"]
        ep["vs_hold_usd"] = ep["wd_usd"] + ep["fee_usd"] - ep["hold_usd_at_close"]
        ep["blocks_held"] = ep["close_block"] - ep["open_block"]
        ep.pop("last_k", None)
    with gzip.open(OUT, "wt") as fh:
        json.dump(episodes, fh)
    closed = [e for e in episodes if e["status"] == "closed" and e["dep_usd"] > 1 and not e.get("contaminated")]
    print(json.dumps({"positions": len(by_pos), "episodes": len(episodes), "closed_ge_$1": len(closed),
                      "owners": len({e["owner"] for e in episodes}),
                      "median_blocks_held_closed": statistics.median(e["blocks_held"] for e in closed) if closed else None},
                     indent=1))


if __name__ == "__main__":
    main()
