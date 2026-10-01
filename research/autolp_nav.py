"""Automated LP (V2) NAV per share at a given block — same method as lib/autolpNav.ts (used to pin the launch baseline
and to cross-check the site). Values each sleeve's position + idle balances (owed performance fees excluded) at the
pool price; uncollected LP fees are excluded (conservative). Read-only."""
import json, sys
from pathlib import Path
from huntx_edge_chain import eth_call

ROOT = Path(__file__).parent
LIVE = json.loads((ROOT.parent / "deployments" / "stock-lp-vault-v2-live.json").read_text())
STATE_VIEW = "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b"
ETH_POOL = "0x24107d152f14a76d292123265ae3f3c71f863fc2f4ef7ba49d64e78d28ea379e"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
Q96 = 2 ** 96


def amounts(L, sP, sL, sU):
    if sP <= sL:
        return L * (sU - sL) / (sL * sU) * Q96, 0.0
    if sP >= sU:
        return 0.0, L * (sU - sL) / Q96
    return L * (sU - sP) / (sP * sU) * Q96, L * (sP - sL) / Q96


def nav(block="latest"):
    one = lambda to, sig, out, args=(), types=(): eth_call(to, sig, list(types), list(args), [out], block)[0]
    V = LIVE["vault"]
    supply = one(V, "totalSupply()", "uint256")
    total_usd = 0.0
    for s in LIVE["sleeves"]:
        sl = s["sleeve"]
        sP, _ = eth_call(sl, "spot()", [], [], ["uint160", "int24"], block)
        lo, hi = one(sl, "tickLower()", "int24"), one(sl, "tickUpper()", "int24")
        L = one(sl, "positionLiquidity()", "uint128")
        share = one(sl, "balanceOf(address)", "uint256", [V], ["address"]) / one(sl, "totalSupply()", "uint256")
        t0, t1 = sorted([s["token"].lower(), USDG])
        b0 = one(t0, "balanceOf(address)", "uint256", [sl], ["address"]) - one(sl, "feeOwed0()", "uint256")
        b1 = one(t1, "balanceOf(address)", "uint256", [sl], ["address"]) - one(sl, "feeOwed1()", "uint256")
        a0, a1 = amounts(L, sP, 1.0001 ** (lo / 2) * Q96, 1.0001 ** (hi / 2) * Q96)
        x0, x1 = a0 + b0, a1 + b1
        p = (sP / Q96) ** 2  # token1 per token0 (raw)
        usdg_raw = x0 + x1 / p if t0 == USDG else x1 + x0 * p
        total_usd += share * usdg_raw / 1e6
    sPe, = eth_call(STATE_VIEW, "getSlot0(bytes32)", ["bytes32"], [bytes.fromhex(ETH_POOL[2:])], ["uint160"], block)
    eth_usd = (sPe / Q96) ** 2 * 1e12
    per_share_usd = total_usd / (supply / 1e18)
    return {"block": block, "navUsd": total_usd, "supply": supply / 1e18, "perShareUsd": per_share_usd,
            "ethUsd": eth_usd, "perShareEth": per_share_usd / eth_usd}


if __name__ == "__main__":
    print(json.dumps(nav(int(sys.argv[1]) if len(sys.argv) > 1 else "latest"), indent=1))
