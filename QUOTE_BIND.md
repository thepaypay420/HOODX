# Synthetic quote bind (RH stock tokens)

PROMETHEUS and similar names trade on **V4 stock-quote pools** (e.g. PROMETHEUS/SPCX, BOW/SPY, SHROOM/MU), not thin ETH stubs. **Naked RH stock stokens** (SPY, NVDA, GME, …) bind directly on their WETH V3 pool when pasted by address.

## Contract (HoodxIndex)

- Whitelisted quotes: any **canonical RH stock/ETF** (18 decimals) via `allowedQuote` + `quoteBridgeV3`
- Bootstrap: 21 stock WETH V3 bridges seeded at init (see `public/rh_bridges.json`)
- Runtime: owner `setQuoteBridge(quote, v3Bridge)` for new stocks or refreshed bridges
- Bind meme: `addToken(token, stockPoolId)` on the name/stock V4 pool
- Bind naked stock: `addToken(spy, wethV3PoolRef)` on SPY/WETH V3
- Buy meme: `WETH → stock (V3) → token (V4)`
- Sell meme: `token → stock (V4) → WETH (V3)`
- NAV: spot on name/quote pool × TWAP on quote/WETH
- `rebindToken(token, poolRef)` when vault bag is zero (fix a bad bind without remove/add)

## Registry

| File | Purpose |
|------|---------|
| `public/rh_stocks.json` | Canonical RH stock + ETF addresses (Investors Center catalog) |
| `public/rh_bridges.json` | Known WETH V3 bridges per stock (refresh via `scripts/refresh_rh_bridges.py`) |
| `lib/rhStocks.ts` | HUD helpers: `isRhStockToken`, `catalogBridge` |

**Not yet supported:** USDG-quoted pools (6 decimals) — most naked stocks have a WETH V3 book; use that path.

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
