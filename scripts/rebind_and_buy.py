#!/usr/bin/env python3
"""Rebind a zero-bag name to Dexscreener's deepest book and buy with V4-safe clip."""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OTHER = Path("/home/thepaytingalebot/bots/other-bot")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(OTHER))
sys.path.insert(0, str(OTHER / "buy-desk"))

import launch_v2  # noqa: E402
from live_funds import LIVE_696X  # noqa: E402
from tx_gas import send_eoa_tx, tx_hash_hex  # noqa: E402

WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
MIN_WEI = 10**14


def cs(w3, addr: str) -> str:
    return w3.to_checksum_address(addr)


def pick_pool(token: str) -> str:
    url = f"https://api.dexscreener.com/token-pairs/v1/robinhood/{token.lower()}"
    req = urllib.request.Request(url, headers={"User-Agent": "hoodx-fix-v4/1"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        pairs = json.loads(resp.read().decode())
    scored = []
    for p in pairs:
        if str(p.get("chainId", "")).lower() != "robinhood":
            continue
        if (p.get("baseToken") or {}).get("address", "").lower() != token.lower():
            continue
        liq = float((p.get("liquidity") or {}).get("usd") or 0)
        if liq <= 0:
            continue
        pool = (p.get("pairAddress") or "").lower()
        labels = [str(x).lower() for x in (p.get("labels") or [])]
        qsym = ((p.get("quoteToken") or {}).get("symbol") or "").upper()
        qaddr = ((p.get("quoteToken") or {}).get("address") or "").lower()
        is_v4 = "v4" in labels or len(pool) == 66
        eth = qsym in {"ETH", "WETH"} or qaddr in {WETH.lower(), "0x0000000000000000000000000000000000000000"}
        usdg = qsym == "USDG"
        if is_v4 and (eth or usdg):
            scored.append((liq, eth, pool))
    if not scored:
        raise SystemExit("no bindable pool on Dexscreener")
    eth_pools = [x for x in scored if x[1]]
    usdg_pools = [x for x in scored if not x[1]]
    best_eth = max(eth_pools, default=None)
    best_usdg = max(usdg_pools, default=None)
    if best_eth and best_usdg:
        pick = best_eth if best_eth[0] >= best_usdg[0] else best_usdg
    else:
        pick = best_eth or best_usdg
    return pick[2]


def max_buy(w3, vault, acct, token: str, cap: int) -> int:
    lo, hi = MIN_WEI, cap
    best = 0
    while lo <= hi:
        mid = (lo + hi) // 2
        twap = vault.functions.quoteOut(cs(w3, WETH), cs(w3, token), mid).call()
        floor = vault.functions.minOutFloor(twap).call()
        try:
            vault.functions.swapV3(cs(w3, WETH), cs(w3, token), mid, floor).call({"from": acct.address})
            best = mid
            lo = mid + 1
        except Exception:
            hi = mid - 1
    return best


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: rebind_and_buy.py <token0x> [maxEth]")
        return 1
    token = sys.argv[1].lower()
    max_eth = float(sys.argv[2]) if len(sys.argv) > 2 else 0.001
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    art = json.loads((ROOT / "out" / "hoodx.json").read_text())
    vault = w3.eth.contract(address=cs(w3, LIVE_696X), abi=art["indexAbi"])
    erc20 = [{"name": "balanceOf", "type": "function", "stateMutability": "view", "inputs": [{"type": "address"}], "outputs": [{"type": "uint256"}]}]
    bag = w3.eth.contract(address=cs(w3, token), abi=erc20).functions.balanceOf(cs(w3, LIVE_696X)).call()
    pool = pick_pool(token)
    cur = vault.functions.poolIdOf(cs(w3, token)).call().hex()
    if bag == 0 and cur != pool.lower().replace("0x", ""):
        fn = vault.functions.rebindToken(cs(w3, token), pool)
        tx = fn.build_transaction({"from": acct.address, "chainId": 4663})
        h = send_eoa_tx(w3, acct, tx)
        print("rebind", tx_hash_hex(h))
        rcpt = w3.eth.wait_for_transaction_receipt(h, timeout=180)
        if rcpt.status != 1:
            raise SystemExit("rebind reverted")
    assets = vault.functions.totalAssets().call()
    weth = vault.functions.wethBuffer().call()
    cash = vault.functions.cashTargetBps().call()
    deploy = max(0, weth - assets * cash // 10_000)
    cap = min(int(max_eth * 1e18), deploy)
    amt = max_buy(w3, vault, acct, token, cap)
    if amt < MIN_WEI:
        raise SystemExit("no size simulates at TWAP floor")
    twap = vault.functions.quoteOut(cs(w3, WETH), cs(w3, token), amt).call()
    floor = vault.functions.minOutFloor(twap).call()
    fn = vault.functions.swapV3(cs(w3, WETH), cs(w3, token), amt, floor)
    tx = fn.build_transaction({"from": acct.address, "chainId": 4663})
    h = send_eoa_tx(w3, acct, tx)
    print("buy", amt / 1e18, "WETH", tx_hash_hex(h))
    rcpt = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    if rcpt.status != 1:
        raise SystemExit("buy reverted")
    bag = w3.eth.contract(address=cs(w3, token), abi=erc20).functions.balanceOf(cs(w3, LIVE_696X)).call()
    print("bag", bag / 1e18)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
