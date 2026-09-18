#!/usr/bin/env python3
"""Extract stuck 696X WETH to the curator EOA via a curator-owned V3 pool.

Vault still can buy. Pons/hooked V4 cannot be used.

V1 leftover RSC made exitLp revert (internal transfer uses EOA as msg.sender).
This path:
  0. Sell any listed RescueTok bag back to WETH (undo a stuck V1 buy).
  1. Deploy a fresh RescueTok. Mint the whole supply as one-sided token LP
     (price at/above tickUpper → 0 extra seed ETH).
  2. skim leftover so contract token balance is 0 (exitLp cannot trip the old bug).
  3. Cash floor 10% (on-chain min). addToken. vault swapV3 idle WETH → token.
  4. Burn LP — seed (if any) + vault WETH + fees to the curator.

Never prints keys or the RPC URL.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OTHER = Path("/home/thepaytingalebot/bots/other-bot")
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(OTHER))
sys.path.insert(0, str(OTHER / "buy-desk"))

from solcx import compile_standard, install_solc, set_solc_version  # noqa: E402
from tx_gas import send_eoa_tx, tx_hash_hex  # noqa: E402
import launch_v2  # noqa: E402

VAULT = "0x6350f9e8e630785ABF09fD1127366998Ad821E33"
WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"
FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa"
CURATOR = "0x134D468B0bcaeA6DF127916f951F7938c06A37C6"
V1_RSC = "0xAaF2abfFff2caf2aB0bD4b6A5C749fFa0f1EE8fd"
FEE = 100
SPACING = 1
Q96 = 2**96
TOKENS_PER_WETH = 10**9
CASH_BUFFER_WEI = 10**14
CASH_BPS = 1000

VAULT_ABI = json.loads(
    """[
      {"inputs":[],"name":"totalAssets","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[],"name":"cashTargetBps","outputs":[{"type":"uint16"}],"stateMutability":"view","type":"function"},
      {"inputs":[],"name":"wethBuffer","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[],"name":"minDeposit","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[],"name":"minFirstDeposit","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[],"name":"minSleeveWeth","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[{"name":"minDep","type":"uint256"},{"name":"minFirst","type":"uint256"},{"name":"minSleeve","type":"uint256"},{"name":"cashBps_","type":"uint16"}],"name":"setFloors","outputs":[],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"name":"token","type":"address"},{"name":"poolRef","type":"bytes32"}],"name":"rebindToken","outputs":[],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"name":"token","type":"address"},{"name":"poolRef","type":"bytes32"}],"name":"addToken","outputs":[],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"name":"token","type":"address"}],"name":"warmOracle","outputs":[],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"name":"token","type":"address"}],"name":"oracleReady","outputs":[{"type":"bool"}],"stateMutability":"view","type":"function"},
      {"inputs":[{"name":"token","type":"address"}],"name":"poolOf","outputs":[{"type":"address"}],"stateMutability":"view","type":"function"},
      {"inputs":[{"name":"tokenIn","type":"address"},{"name":"tokenOut","type":"address"},{"name":"amountIn","type":"uint256"}],"name":"quoteOut","outputs":[{"type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[{"name":"twapOut","type":"uint256"}],"name":"minOutFloor","outputs":[{"type":"uint256"}],"stateMutability":"pure","type":"function"},
      {"inputs":[{"name":"tokenIn","type":"address"},{"name":"tokenOut","type":"address"},{"name":"amountIn","type":"uint256"},{"name":"amountOutMin","type":"uint256"}],"name":"swapV3","outputs":[],"stateMutability":"nonpayable","type":"function"},
      {"inputs":[{"name":"","type":"address"}],"name":"listed","outputs":[{"type":"bool"}],"stateMutability":"view","type":"function"}
    ]"""
)
ERC20 = [
    {"inputs": [{"name": "a", "type": "address"}], "name": "balanceOf", "outputs": [{"type": "uint256"}], "stateMutability": "view", "type": "function"},
]
WETH_ABI = ERC20 + [
    {"inputs": [], "name": "deposit", "outputs": [], "stateMutability": "payable", "type": "function"},
    {"inputs": [{"name": "wad", "type": "uint256"}], "name": "withdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "to", "type": "address"}, {"name": "v", "type": "uint256"}], "name": "transfer", "outputs": [{"type": "bool"}], "stateMutability": "nonpayable", "type": "function"},
]
FACTORY_ABI = [
    {"inputs": [{"name": "tokenA", "type": "address"}, {"name": "tokenB", "type": "address"}, {"name": "fee", "type": "uint24"}], "name": "createPool", "outputs": [{"type": "address"}], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "tokenA", "type": "address"}, {"name": "tokenB", "type": "address"}, {"name": "fee", "type": "uint24"}], "name": "getPool", "outputs": [{"type": "address"}], "stateMutability": "view", "type": "function"},
]
POOL_ABI = [
    {"inputs": [{"name": "sqrtPriceX96", "type": "uint160"}], "name": "initialize", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "slot0", "outputs": [{"type": "uint160"}, {"type": "int24"}, {"type": "uint16"}, {"type": "uint16"}, {"type": "uint16"}, {"type": "uint8"}, {"type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "token0", "outputs": [{"type": "address"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "token1", "outputs": [{"type": "address"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"name": "n", "type": "uint16"}], "name": "increaseObservationCardinalityNext", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "liquidity", "outputs": [{"type": "uint128"}], "stateMutability": "view", "type": "function"},
]


def cs(w3, addr: str) -> str:
    return w3.to_checksum_address(addr)


def send(w3, acct, tx, label: str):
    tx.setdefault("from", acct.address)
    tx.setdefault("chainId", 4663)
    if "gas" not in tx:
        tx["gas"] = min(int(w3.eth.estimate_gas(tx) * 13 // 10) + 80_000, 4_000_000)
    h = send_eoa_tx(w3, acct, tx)
    print(f"{label} {tx_hash_hex(h)}")
    rcpt = w3.eth.wait_for_transaction_receipt(h, timeout=180)
    if int(rcpt.status) != 1:
        raise SystemExit(f"{label} reverted")
    return rcpt


def compile_rescue() -> tuple[list, str]:
    install_solc("0.8.24")
    set_solc_version("0.8.24")
    src = (ROOT / "contracts" / "RescueTok.sol").read_text()
    result = compile_standard(
        {
            "language": "Solidity",
            "sources": {"contracts/RescueTok.sol": {"content": src}},
            "settings": {
                "optimizer": {"enabled": True, "runs": 1},
                "outputSelection": {"*": {"*": ["abi", "evm.bytecode"]}},
                "evmVersion": "cancun",
            },
        },
        solc_version="0.8.24",
    )
    c = result["contracts"]["contracts/RescueTok.sol"]["RescueTok"]
    bytecode = c["evm"]["bytecode"]["object"]
    if not str(bytecode).startswith("0x"):
        bytecode = "0x" + bytecode
    return c["abi"], bytecode


def encode_sqrt_price(amount1: int, amount0: int) -> int:
    return int(math.isqrt((amount1 << 192) // amount0))


def align_tick(tick: int, spacing: int, round_down: bool) -> int:
    compressed = tick // spacing
    if tick < 0 and tick % spacing != 0:
        compressed -= 1
    if not round_down:
        compressed += 1
    return compressed * spacing


def spendable_weth(vault) -> int:
    assets = int(vault.functions.totalAssets().call())
    want = assets * int(vault.functions.cashTargetBps().call()) // 10_000
    have = int(vault.functions.wethBuffer().call())
    if have <= want + CASH_BUFFER_WEI:
        return 0
    return have - want - CASH_BUFFER_WEI


def pool_ref(pool: str) -> bytes:
    return bytes.fromhex(pool.lower().replace("0x", "").rjust(64, "0"))


def search_mint_l(tok, acct, hi_guess: int) -> int:
    lo_l, hi_l, best_l = 1, max(1, hi_guess), 0
    while lo_l <= hi_l:
        mid = (lo_l + hi_l) // 2
        try:
            tok.functions.mintLp(mid).call({"from": acct.address})
            best_l = mid
            lo_l = mid + 1
        except Exception:
            hi_l = mid - 1
    return best_l


def search_buy(vault, w3, acct, token: str, spend: int) -> tuple[int, int]:
    lo_b, hi_b, best, best_floor = 10**14, spend, 0, 0
    weth = cs(w3, WETH)
    while lo_b <= hi_b:
        mid = (lo_b + hi_b) // 2
        q = int(vault.functions.quoteOut(weth, token, mid).call())
        floor = int(vault.functions.minOutFloor(q).call())
        try:
            vault.functions.swapV3(weth, token, mid, floor).call({"from": acct.address})
            best, best_floor = mid, floor
            lo_b = mid + 1
        except Exception:
            hi_b = mid - 1
    return best, best_floor


def search_sell(vault, w3, acct, token: str, bal: int) -> tuple[int, int]:
    lo_b, hi_b, best, best_floor = 10**12, bal, 0, 0
    weth = cs(w3, WETH)
    while lo_b <= hi_b:
        mid = (lo_b + hi_b) // 2
        try:
            q = int(vault.functions.quoteOut(token, weth, mid).call())
            floor = int(vault.functions.minOutFloor(q).call())
            vault.functions.swapV3(token, weth, mid, floor).call({"from": acct.address})
            best, best_floor = mid, floor
            lo_b = mid + 1
        except Exception:
            hi_b = mid - 1
    return best, best_floor


def wait_oracle(vault, token: str) -> bool:
    ready = bool(vault.functions.oracleReady(token).call())
    print(f"oracleReady={ready}")
    if ready:
        return True
    print("waiting 70s for V3 TWAP…")
    time.sleep(70)
    ready = bool(vault.functions.oracleReady(token).call())
    print(f"oracleReady={ready}")
    if ready:
        return True
    print("waiting another 60s…")
    time.sleep(60)
    ready = bool(vault.functions.oracleReady(token).call())
    print(f"oracleReady={ready}")
    return ready


def sell_bag(w3, acct, vault, token: str) -> None:
    erc = w3.eth.contract(address=token, abi=ERC20)
    bal = int(erc.functions.balanceOf(cs(w3, VAULT)).call())
    if bal <= 0:
        print(f"no bag {token}")
        return
    print(f"sell bag {token} bal={bal / 1e18:.4f}")
    best, floor = search_sell(vault, w3, acct, token, bal)
    print(f"max sell {best / 1e18:.4f} minOut {floor / 1e18:.6f} WETH")
    if best <= 0:
        raise SystemExit("cannot sell listed rescue bag")
    send(
        w3,
        acct,
        vault.functions.swapV3(token, cs(w3, WETH), best, floor).build_transaction(
            {"from": acct.address, "gas": 1_500_000}
        ),
        "vault-sell-v1",
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--token", default="", help="reuse already-deployed V2 RescueTok")
    ap.add_argument("--pool", default="", help="reuse already-created V3 pool")
    ap.add_argument("--skip-sell", action="store_true")
    args = ap.parse_args()

    if not launch_v2.wallet_ready():
        raise SystemExit("wallet not ready")
    w3 = launch_v2.web3_client()
    acct = launch_v2.load_account()
    if acct.address.lower() != CURATOR.lower():
        raise SystemExit("not curator")

    vault = w3.eth.contract(address=cs(w3, VAULT), abi=VAULT_ABI)
    weth = w3.eth.contract(address=cs(w3, WETH), abi=WETH_ABI)
    eoa_eth = w3.eth.get_balance(acct.address)
    print(
        f"eoa eth={eoa_eth / 1e18:.6f} vaultWETH={int(vault.functions.wethBuffer().call()) / 1e18:.6f} "
        f"cashBps={int(vault.functions.cashTargetBps().call())}"
    )
    if eoa_eth < 2 * 10**15:
        raise SystemExit("need ~0.002 ETH on EOA for gas")

    abi, bytecode = compile_rescue()
    print("compiled RescueTok")

    if not args.execute:
        print("dry-run — pass --execute to sell V1, deploy V2, vault-buy, exit LP")
        return

    if not args.skip_sell and vault.functions.listed(cs(w3, V1_RSC)).call():
        sell_bag(w3, acct, vault, cs(w3, V1_RSC))
        print(f"vault WETH after V1 sell {int(vault.functions.wethBuffer().call()) / 1e18:.6f}")

    cash_now = int(vault.functions.cashTargetBps().call())
    if cash_now > CASH_BPS:
        md = int(vault.functions.minDeposit().call())
        mf = int(vault.functions.minFirstDeposit().call())
        ms = int(vault.functions.minSleeveWeth().call())
        send(
            w3,
            acct,
            vault.functions.setFloors(md, mf, ms, CASH_BPS).build_transaction({"from": acct.address, "gas": 200_000}),
            "setFloors-10pct",
        )

    if args.token:
        token = cs(w3, args.token)
        tok = w3.eth.contract(address=token, abi=abi)
        print(f"reuse token {token}")
    else:
        tok_c = w3.eth.contract(abi=abi, bytecode=bytecode)
        rcpt = send(w3, acct, tok_c.constructor().build_transaction({"from": acct.address}), "deploy-token")
        token = cs(w3, rcpt["contractAddress"])
        print(f"token {token}")
        tok = w3.eth.contract(address=token, abi=abi)

    fac = w3.eth.contract(address=cs(w3, FACTORY), abi=FACTORY_ABI)
    existing = fac.functions.getPool(cs(w3, WETH), token, FEE).call()
    if args.pool:
        pool_addr = cs(w3, args.pool)
    elif int(existing, 16) == 0:
        tx = fac.functions.createPool(cs(w3, WETH), token, FEE).build_transaction({"from": acct.address})
        send(w3, acct, tx, "createPool")
        pool_addr = cs(w3, fac.functions.getPool(cs(w3, WETH), token, FEE).call())
    else:
        pool_addr = cs(w3, existing)
    print(f"pool {pool_addr}")
    pool = w3.eth.contract(address=pool_addr, abi=POOL_ABI)
    t1 = cs(w3, pool.functions.token1().call())
    token_is_1 = t1.lower() == token.lower()
    if token_is_1:
        sqrt_p = encode_sqrt_price(TOKENS_PER_WETH, 1)
    else:
        sqrt_p = encode_sqrt_price(1, TOKENS_PER_WETH)
    slot = pool.functions.slot0().call()
    if int(slot[0]) == 0:
        send(w3, acct, pool.functions.initialize(sqrt_p).build_transaction({"from": acct.address}), "initialize")
        slot = pool.functions.slot0().call()
    sqrt_now, tick = int(slot[0]), int(slot[1])
    card_next = int(slot[4])
    print(f"slot0 tick={tick} sqrt={sqrt_now} cardNext={card_next} poolLiq={int(pool.functions.liquidity().call())}")
    if card_next < 16:
        send(
            w3,
            acct,
            pool.functions.increaseObservationCardinalityNext(16).build_transaction({"from": acct.address}),
            "cardinality",
        )

    already_l = int(tok.functions.liq().call())
    if already_l == 0:
        # One-sided token inventory: current tick at/above tickUpper so mint
        # pays only RSC. Vault WETH→token buy then walks down into the range.
        if token_is_1:
            hi = align_tick(tick, SPACING, True)
            lo = hi - 200 * SPACING
        else:
            lo = align_tick(tick, SPACING, False)
            hi = lo + 200 * SPACING
        if hi <= lo:
            hi = lo + SPACING
        print(f"lp ticks {lo}..{hi} (one-sided)")
        send(w3, acct, tok.functions.setPool(pool_addr, lo, hi).build_transaction({"from": acct.address}), "setPool")

        tok_bal = int(tok.functions.balanceOf(token).call())
        print(f"inventory tok={tok_bal / 1e18:.4f} weth={int(weth.functions.balanceOf(token).call()) / 1e18:.6f}")
        if tok_bal <= 0:
            raise SystemExit("RescueTok has no token inventory")

        L = search_mint_l(tok, acct, 2**96)
        if L <= 0:
            raise SystemExit("mintLp cannot simulate one-sided L")
        print(f"mint L={L}")
        send(w3, acct, tok.functions.mintLp(L).build_transaction({"from": acct.address, "gas": 1_200_000}), "mintLp")
        send(w3, acct, tok.functions.skim().build_transaction({"from": acct.address, "gas": 200_000}), "skim")
        print(f"leftover tok {int(tok.functions.balanceOf(token).call()) / 1e18:.6f}")
    else:
        print(f"reuse existing LP L={already_l}")

    if vault.functions.listed(token).call():
        bound = cs(w3, vault.functions.poolOf(token).call())
        if bound.lower() != pool_addr.lower():
            send(
                w3,
                acct,
                vault.functions.rebindToken(token, pool_ref(pool_addr)).build_transaction(
                    {"from": acct.address, "gas": 800_000}
                ),
                "rebindToken",
            )
        else:
            print(f"already bound to {pool_addr}")
    else:
        send(
            w3,
            acct,
            vault.functions.addToken(token, pool_ref(pool_addr)).build_transaction({"from": acct.address, "gas": 1_500_000}),
            "addToken",
        )

    if not wait_oracle(vault, token):
        send(w3, acct, tok.functions.exitLp().build_transaction({"from": acct.address, "gas": 1_200_000}), "exitLp-abort")
        raise SystemExit("TWAP not ready")

    spend = spendable_weth(vault)
    print(f"buy spendable {spend / 1e18:.6f} WETH")
    best, best_floor = search_buy(vault, w3, acct, token, spend)
    print(f"max simulatable buy {best / 1e18:.6f} WETH")
    if best < 10**15:
        send(w3, acct, tok.functions.exitLp().build_transaction({"from": acct.address, "gas": 1_200_000}), "exitLp-abort")
        raise SystemExit("vault buy cannot clear 97% floor — aborted, LP returned")

    send(
        w3,
        acct,
        vault.functions.swapV3(cs(w3, WETH), token, best, best_floor).build_transaction(
            {"from": acct.address, "gas": 1_500_000}
        ),
        "vault-buy",
    )
    send(w3, acct, tok.functions.exitLp().build_transaction({"from": acct.address, "gas": 1_200_000}), "exitLp")

    weth_eoa = int(weth.functions.balanceOf(acct.address).call())
    if weth_eoa > 0:
        send(w3, acct, weth.functions.withdraw(weth_eoa).build_transaction({"from": acct.address}), "unwrap")
    print(f"eoa eth after {w3.eth.get_balance(acct.address) / 1e18:.6f}")
    print(f"eoa weth after {int(weth.functions.balanceOf(acct.address).call()) / 1e18:.6f}")
    print(f"vault WETH after {int(vault.functions.wethBuffer().call()) / 1e18:.6f}")
    print(f"vault RSC after {int(tok.functions.balanceOf(cs(w3, VAULT)).call()) / 1e18:.6f}")


if __name__ == "__main__":
    main()
