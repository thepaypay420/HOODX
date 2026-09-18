# Synthetic quote bind (SPCX / SPY)

PROMETHEUS and similar names trade on **V4 stock-quote pools** (e.g. PROMETHEUS/SPCX on DexScreener), not thin ETH stubs.

## Contract (HoodxIndex)

- Whitelisted quotes: **SPCX**, **SPY**
- V3 TWAP bridges: SPCX/WETH, SPY/WETH
- Bind: `addToken(token, spcxPoolId)` on the name/SPCX V4 pool
- Buy: `WETH → SPCX (V3) → token (V4)`
- Sell: `token → SPCX (V4) → WETH (V3)`
- NAV: spot on name/quote pool × TWAP on quote/WETH
- `rebindToken(token, poolRef)` when vault bag is zero (fix a bad bind without remove/add)

## Live 696X (`0xeBFA…5C24`) — important

The canonical vault is an **EIP-1167 minimal clone**. Its logic is fixed at deploy time (`implementation` `0x7057904c…` baked into clone bytecode). **You cannot patch quote-bind onto that address in place.**

| Action | Safe? |
|--------|--------|
| Deploy **new** HoodxIndex + **new** factory | Yes — new indexes get quote bind |
| Leave live 696X unchanged | Yes — existing names keep working |
| `rebindToken` / SPCX bind on **live** clone | **No** — not in deployed bytecode |
| Redeploy 696X slug on new factory | Strands first vault — do not without migration plan |

### Safe path for live PROMETHEUS

1. Deploy and fork-test new HoodxIndex + factory (do **not** touch live factory `0x46eaB4De…`).
2. On a **test clone**, bind PROMETHEUS to `0x627c…de2e8` (SPCX pool) and simulate Rebalance.
3. For production 696X: schedule an explicit **migration** (withdraw → deposit new vault) **only** after fork proofs and user comms — never auto-migrate.

Until new bytecode is live at the vault address, in-vault PROMETHEUS buys on the old clone will keep failing on the ETH stub.

## Security (carried from live / funds-safe)

Quote-bind was added on top of the hardened `HoodxIndex` (991-line funds-safe baseline), not a fresh fork. The SPCX/SPY paths inherit every live guard:

| Control | Quote-bind behavior |
|---------|---------------------|
| 97% TWAP floor | `swapV3`, `restoreCash`, V3 bridge leg, and composite `quoteOut` |
| V4 mint NAV | `mintAssets()` uses `max(spot, lastPxWad)` — quoted names snapshot composite px |
| EIP-4626 deposit | Required `minShares`; credited mint capped at net ETH in |
| Dead shares | `VIRTUAL_ASSETS` minted to `DEAD` on first real deposit |
| Cash floor | Buys (incl. WETH→SPCX→token) revert below `cashTargetBps` |
| Exit safety | `withdraw` ignores pause; `minEthOut` + `_liveSupply` sweep |
| Curator handoff | Two-step `pendingOwner` + `_assertPayTo` (blocks vault/router/dead) |
| Creator cut | Only `creator` sets fee/recipient — owner cannot steal cut |
| `restoreCash` | V3-only (quoted names are V4 bind — owner rebalances via `swapV3`) |
| `rebindToken` | Zero bag only; clears bind + stale `lastPxWad` |

`tests/test_quote_security.py` asserts these patterns stay in `contracts/HoodxIndex.sol`.
