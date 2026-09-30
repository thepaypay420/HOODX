"""Loop v2 iteration 2: deterministic entry/exit cost per stock at the current block.

For every stock/USDG hookless static-fee V4 pool with active liquidity, quote a USDG -> stock -> USDG
round trip at $25 / $250 / $1000 and report the cheapest pool per symbol vs the sleeve-style 0.30% pool.
Read-only eth_call; RPC-capped.
"""
import gzip, json, sys
from pathlib import Path
import requests
import feex_next_day_check as fx
from huntx_edge_chain import eth_call
from huntx_edge_engine import quote_exact_in, save_cache

ROOT = Path(__file__).parent
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
STATE_VIEW = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b"
SIZES = (25, 250, 1000)
RPC_BUDGET = 5_000
_calls = {"n": 0}
_post = requests.post


def _counted_post(*a, **k):
    _calls["n"] += 1
    if _calls["n"] > RPC_BUDGET:
        save_cache()
        sys.exit("RPC budget reached")
    return _post(*a, **k)


requests.post = _counted_post


def main():
    block = int(fx.rpc("eth_blockNumber", []), 16)
    stocks = {t["token"].lower(): t["symbol"] for t in json.loads((ROOT.parent / "public" / "rh_stocks.json").read_text())["tokens"]}
    reg = json.load(gzip.open(ROOT / "huntx_edge_registry.json.gz"))
    cands = {}
    for p in reg["pools"]:
        c0, c1 = p["currency0"], p["currency1"]
        if USDG not in (c0, c1) or int(p["hooks"], 16) != 0 or p["fee"] > 30_000:
            continue
        tok = c1 if c0 == USDG else c0
        if tok in stocks:
            cands.setdefault(stocks[tok], []).append(p)
    out = {"block": block, "symbols": {}}
    for sym, pools in sorted(cands.items()):
        live = []
        for p in pools:
            (liq,) = eth_call(STATE_VIEW, "getLiquidity(bytes32)", ["bytes32"], [bytes.fromhex(p["pool_id"][2:])], ["uint128"], block)
            if liq > 0:
                live.append(p)
        rows = []
        for p in live:
            usdg_is0 = p["currency0"] == USDG
            r = {"pool": p["pool_id"], "fee": p["fee"], "spacing": p["tick_spacing"]}
            for usd in SIZES:
                amt = usd * 10**6
                got = quote_exact_in(p, usdg_is0, amt, block)  # buy stock
                back = quote_exact_in(p, not usdg_is0, got, block) if got else None  # sell it back
                r[f"rt_bps_{usd}"] = None if not back else round(10_000 * (1 - back / amt), 1)
            rows.append(r)
        ok = [r for r in rows if r[f"rt_bps_{SIZES[1]}"] is not None]
        best = {usd: min((r for r in ok if r[f"rt_bps_{usd}"] is not None), key=lambda r: r[f"rt_bps_{usd}"], default=None)
                for usd in SIZES}
        out["symbols"][sym] = {"live_pools": len(live), "pools": rows,
                               "best": {usd: (b and {"pool": b["pool"], "fee": b["fee"], "rt_bps": b[f"rt_bps_{usd}"]}) for usd, b in best.items()}}
        b = best[SIZES[1]]
        print(sym, "live", len(live), "best@$250", b and (b["fee"], b[f"rt_bps_{SIZES[1]}"]), "rpc", _calls["n"], flush=True)
        save_cache()
    out["rpc"] = _calls["n"]
    (ROOT / "huntx_route_costs.json").write_text(json.dumps(out, indent=1))
    print("done rpc", _calls["n"])


if __name__ == "__main__":
    main()
