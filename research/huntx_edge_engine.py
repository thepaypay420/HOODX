"""HUNTX edge engine: decision-time features, gates, exact-quote outcomes.

Implements docs/HUNTX-EDGE-PREREGISTRATION-2026-09-30.md. Everything is
read-only: swap logs from huntx_edge_panel_scan.py plus archive eth_call
(StateView, V4Quoter). All archive reads are cached on disk so the study is
reproducible offline once the cache is populated.
"""

from __future__ import annotations

import bisect
import gzip
import json
import math
import threading
import time
from pathlib import Path

import requests

from eth_abi import decode, encode
from web3 import Web3

import feex_next_day_check as fx
from feex_next_day_check import rpc
from huntx_edge_chain import (Q128, STATE_VIEW, USDG, V4_QUOTER, WETH, pid_bytes)

ROOT = Path(__file__).parent
CACHE_FILE = ROOT / "huntx_edge_rpc_cache.json.gz"
NATIVE = "0x" + "0" * 40
MAJORS = {USDG, WETH, NATIVE}
LN_TICK = math.log(1.0001)

_cache: dict = {}
_lock = threading.Lock()
_dirty = [0]


def load_cache():
    global _cache
    if CACHE_FILE.exists():
        _cache = json.load(gzip.open(CACHE_FILE, "rt", encoding="utf-8"))


def save_cache():
    with _lock:
        snapshot = dict(_cache)
    with gzip.open(CACHE_FILE, "wt", encoding="utf-8") as fh:
        json.dump(snapshot, fh, separators=(",", ":"))


def cached_call(key: str, fn):
    with _lock:
        if key in _cache:
            return _cache[key]
    value = fn()
    with _lock:
        _cache[key] = value
        _dirty[0] += 1
    return value


class Reverted(Exception):
    """The call executed and reverted (a genuine quote/contract failure)."""


_rate_lock = threading.Lock()
_next_slot = [0.0]
RATE = 40.0   # calls/s, under the 50/s provider cap


def _throttle():
    with _rate_lock:
        now = time.time()
        slot = max(now, _next_slot[0])
        _next_slot[0] = slot + 1.0 / RATE
    time.sleep(max(0.0, slot - now))


def _call(to, sig, types, args, out, block):
    """eth_call with throttling. Rate-limit/transport errors retry; reverts raise Reverted."""
    sel = Web3.keccak(text=sig)[:4].hex().removeprefix("0x")
    data = "0x" + sel + encode(types, args).hex()
    body = {"jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [{"to": to, "data": data}, hex(block)]}
    for attempt in range(12):
        _throttle()
        try:
            payload = requests.post(fx.ENDPOINT, json=body, timeout=30, verify=fx.TLS_VERIFY).json()
        except (requests.RequestException, ValueError):
            time.sleep(1 + attempt)
            continue
        if "result" in payload:
            return list(decode(out, bytes.fromhex(payload["result"][2:])))
        err = payload.get("error", {})
        msg = str(err.get("message", "")).lower()
        if "revert" in msg or err.get("code") == 3:
            raise Reverted(msg[:120])
        time.sleep(1 + attempt)          # rate limit or transient provider error
    raise RuntimeError("eth_call failed after retries (not a revert)")


def fee_growth(pool_id: str, block: int):
    def f():
        g = _call(STATE_VIEW, "getFeeGrowthGlobals(bytes32)", ["bytes32"], [pid_bytes(pool_id)],
                  ["uint256", "uint256"], block)
        return [str(g[0]), str(g[1])]
    v = cached_call(f"fg:{pool_id}:{block}", f)
    return int(v[0]), int(v[1])


def slot0(pool_id: str, block: int):
    def f():
        return _call(STATE_VIEW, "getSlot0(bytes32)", ["bytes32"], [pid_bytes(pool_id)],
                     ["uint160", "int24", "uint24", "uint24"], block)
    s, tick, proto, lp = cached_call(f"s0:{pool_id}:{block}", f)
    return {"sqrt": int(s), "tick": tick, "proto0": proto & 0xFFF, "proto1": proto >> 12, "lp_fee": lp}


def quote_exact_in(meta: dict, zero_for_one: bool, amount: int, block: int):
    """V4Quoter exact-input at archive block. Returns amount out or None (failure)."""
    if amount <= 0:
        return 0

    def f():
        key = (Web3.to_checksum_address(meta["currency0"]), Web3.to_checksum_address(meta["currency1"]),
               meta["fee"], meta["tick_spacing"], Web3.to_checksum_address(meta["hooks"]))
        sig = "quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))"
        try:
            out = _call(V4_QUOTER, sig, ["((address,address,uint24,int24,address),bool,uint128,bytes)"],
                        [(key, zero_for_one, amount, b"")], ["uint256", "uint256"], block)
            return str(out[0])
        except Reverted:
            return None
    v = cached_call(f"q:{meta['pool_id']}:{block}:{int(zero_for_one)}:{amount}", f)
    return None if v is None else int(v)


# ---------------------------------------------------------------- pool maths

def tick_of_sqrt(s: float) -> float:
    return 2 * math.log(s) / LN_TICK


def sqrt_of_tick(t: int) -> float:
    return math.exp(t * LN_TICK / 2)


def snap_range(s: float, lo_mult: float, hi_mult: float, spacing: int, quote_is_1: bool):
    """Range in *token price* multiples of current price, snapped outward to spacing.

    Token price (quote per token) = s^2 if quote is currency1, else 1/s^2.
    """
    if quote_is_1:
        sa, sb = s * math.sqrt(lo_mult), s * math.sqrt(hi_mult)
    else:
        sa, sb = s / math.sqrt(hi_mult), s / math.sqrt(lo_mult)
    ta = math.floor(tick_of_sqrt(sa) / spacing) * spacing
    tb = math.ceil(tick_of_sqrt(sb) / spacing) * spacing
    if tb <= ta:
        tb = ta + spacing
    return sqrt_of_tick(ta), sqrt_of_tick(tb), ta, tb


def amounts(liq: float, s: float, sa: float, sb: float):
    if s <= sa:
        return liq * (sb - sa) / (sa * sb), 0.0
    if s >= sb:
        return 0.0, liq * (sb - sa)
    return liq * (sb - s) / (s * sb), liq * (s - sa)


def value_in_quote(a0: float, a1: float, s: float, quote_is_1: bool) -> float:
    return a1 + a0 * s * s if quote_is_1 else a0 + a1 / (s * s)


def path_fraction(p0: float, p1: float, la: float, lb: float) -> float:
    """Fraction of the log-sqrt path [p0 -> p1] inside [la, lb] (all logs)."""
    lo, hi = min(p0, p1), max(p0, p1)
    if hi - lo < 1e-15:
        return 1.0 if la <= lo <= lb else 0.0
    return max(0.0, min(hi, lb) - max(lo, la)) / (hi - lo)


class PoolSeries:
    """Swap series for one pool with decision-time slicing helpers."""

    def __init__(self, pool_id: str, meta: dict, rows: list):
        self.pool_id = pool_id
        self.meta = meta
        self.rows = rows
        self.blocks = [r[0] for r in rows]
        # Quote preference: USDG > WETH > native ETH.
        c0, c1 = meta["currency0"], meta["currency1"]
        if USDG in (c0, c1):
            self.quote = USDG
        elif WETH in (c0, c1):
            self.quote = WETH
        else:
            self.quote = NATIVE
        self.quote_is_1 = (c1 == self.quote)
        self.token = c0 if self.quote_is_1 else c1
        self.quote_decimals = 6 if self.quote == USDG else 18
        self.major_pair = self.token in MAJORS

    def idx_before(self, block: int) -> int:
        """Index of first swap with block >= `block` (swaps strictly before are [:idx])."""
        return bisect.bisect_left(self.blocks, block)

    def sqrt_before(self, block: int):
        i = self.idx_before(block)
        if i == 0:
            return None
        return self.rows[i - 1][4] / 2**96

    def liq_before(self, block: int):
        i = self.idx_before(block)
        return None if i == 0 else self.rows[i - 1][5]

    def window(self, a: int, b: int):
        return self.rows[self.idx_before(a):self.idx_before(b)]

    def fee_accrual(self, a: int, b: int, sa: float, sb: float, liq_ours: float,
                    proto0: int, proto1: int, start_sqrt: float):
        """Position fees (raw token0, token1) plus event-model global growth for calibration."""
        la, lb = math.log(sa), math.log(sb)
        prev = math.log(start_sqrt)
        f0 = f1 = 0.0
        g0 = g1 = 0.0
        for r in self.window(a, b):
            a0, a1, sq, liq, fee = r[2], r[3], r[4], r[5], r[7]
            cur = math.log(sq / 2**96)
            if liq > 0:
                zero_in = a0 < 0
                gross = -a0 if zero_in else -a1
                if gross > 0:
                    lp = gross * max(fee - (proto0 if zero_in else proto1), 0) / 1e6
                    frac = path_fraction(prev, cur, la, lb)
                    ours = lp * liq_ours / (liq + liq_ours) * frac
                    if zero_in:
                        f0 += ours
                        g0 += lp / liq
                    else:
                        f1 += ours
                        g1 += lp / liq
            prev = cur
        return f0, f1, g0, g1


def calibration(series: PoolSeries, a: int, b: int, g0_event: float, g1_event: float):
    """On-chain / event fee-growth ratio per token over [a, b) (blocks a-1 .. b-1 state)."""
    x0, x1 = fee_growth(series.pool_id, a - 1)
    y0, y1 = fee_growth(series.pool_id, b - 1)
    d0 = ((y0 - x0) % 2**256) / Q128
    d1 = ((y1 - x1) % 2**256) / Q128
    r0 = d0 / g0_event if g0_event > 0 else (1.0 if d0 == 0 else None)
    r1 = d1 / g1_event if g1_event > 0 else (1.0 if d1 == 0 else None)
    return r0, r1, d0, d1
