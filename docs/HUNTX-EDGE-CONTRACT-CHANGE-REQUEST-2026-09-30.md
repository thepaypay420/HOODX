# Proposed contract change — H3 "conditioned USDG bid" LP sleeve (NOT approved, NOT implemented)

Status: **proposal only**. The HUNTX V3 economic launch gate stays **BLOCKED**.
This request exists because the only surviving candidate (H3, see
`docs/HUNTX-EDGE-SLICE-FINDINGS-2026-09-30.md` §7) cannot run on the current
contracts. It needs its own security and economic review before any code is
written for production.

## Why HUNTX V3 cannot express H3

`contracts/launch/HoodxLaunchHunterV3.sol` is a WETH swap-and-hold prober:
fixed 10% probes (`MIN/MAX_PROBE_BPS = 1000`), `MAX_ACTIVE = 2`,
`MAX_HOLD = 4 hours`, and +50% / −20% oracle exits through `_trade`. It holds
no Uniswap V4 position NFTs, has no USDG accounting, and cannot place a range.
H3 is a USDG-only concentrated-liquidity **bid** below the price on V4 pools,
held for 3 days.

## What H3 needs (minimum)

| Need | Detail |
|---|---|
| Asset | USDG sleeve (the study numeraire), separate from the WETH sleeve |
| Venue | Uniswap V4 PositionManager `0x58daec…4fA7`; **unhooked** pools only (`hooks == 0`) |
| Position | Mint a single range entirely below price (USDG-only); `decreaseLiquidity` + `collect`; burn |
| Holding | Exactly 3 days, then a full exit; residual tokens sold with a slippage floor |
| Concurrency | K ≤ 3 positions; no two positions share a token or a pool initializer |
| Sizing | $200 / K per position; per-position loss is bounded by the position size (no leverage) |
| Decision | Off-chain keeper computes the frozen H3 features at 00:00 UTC; the contract enforces only hard guards |

## On-chain guards the module must enforce (keeper is untrusted)

1. Pool is unhooked, its fee tier is > 0, and one currency is USDG.
2. Minted range lies strictly on the USDG side of `slot0` at mint (reverts otherwise).
   This is the exact defect found in the backtest; the contract must make it impossible.
3. Position size ≤ cap; ≤ 3 open positions; ≤ 1 per token.
4. Exit is callable by anyone after 3 days (keeper failure must not trap funds).
   Swaps of residual tokens use a min-out from an independent quote, with a
   fallback of in-kind withdrawal to the vault (no forced sale into a drained
   pool, see the zero-liquidity case in findings §4.4).
5. Direct PositionManager recovery with no website or API dependency. Redeem-in-kind
   must be able to hand out tokens and USDG held in positions.
6. Pause on entries only, never on exits.

## Evidence still required before this request can be approved

* Prospective shadow: ≥ 30 frozen daily decisions scored after their 3-day
  hold, with a positive day-clustered lower bound.
* Position-exact fee validation on a local fork. Mint the bid at the
  decision block and replay the recorded swaps, so the vault's own
  liquidity affects the price path. This replaces the calibrated event model.
* Fork tests on actual selected tokens: transfer tax, reverting/blacklisting
  tokens, gas-heavy tokens, dust, a drained pool at exit, and one bad asset while
  other holders redeem.
* Security review of the new module and its keeper role.
