# HOODX PONS V3 fee-machine research

**Research snapshot:** 29 September 2026

**Decision:** a protocol-controlled $200 canary is justified after local-fork integration tests; public deposits are not yet justified.

## Breakthrough

The first Launch Hunter study examined new Uniswap v4 pools. That population does not give an outside HOODX LP a reliable fee stream: PONS v2 uses a zero core pool fee and its hook routes the trading charge to protocol, creator and buyback accounting.

The unexplored opportunity is the legacy PONS v1 population. These are ordinary Uniswap v3 WETH pools with a 1% fee tier. An external HOODX position can earn its own pro-rata liquidity fees. The base PONS position stays locked; HOODX owns and can withdraw only the new position it mints.

The active population is large:

- 242,858 canonical PONS v1 launches were reconstructed from the factory.
- 4,346 pools traded during 21–28 September.
- 315,375 relevant swaps were replayed in that evaluation week.
- The preceding two weekly ranking and evaluation windows contained another 2.7 million relevant swaps.

The useful edge is not chasing newly created pools. It is renting narrow liquidity to the small set of old PONS pools whose recurring routing flow continues to pay a 1% fee.

## Fee-accounting proof

The canonical candidate pools expose:

- pool fee: 10,000 pips, or 1%;
- `feeProtocol`: `0x66`;
- LP share of each swap fee: 5/6;
- protocol share of each swap fee: 1/6.

The replay now applies the 5/6 haircut. It was independently reconciled against historical `feeGrowthGlobal0X128` and `feeGrowthGlobal1X128` values for DELTA, PONGO and GIWA. Event-derived and contract-state fee growth matched within 2.1% in every checked currency. The remaining difference is consistent with using post-swap active liquidity around tick crossings.

This correction materially reduced the first estimate. All results below use the corrected LP fee share.

## Frozen strategy

The candidate pilot is deliberately simple:

1. Hold 25% in WETH.
2. Allocate 25% each to DELTA/WETH, PONGO/WETH and GIWA/WETH.
3. Mint a centered Uniswap v3 range extending 10% below and 10% above the entry price.
4. Do not chase an out-of-range position during the week.
5. Recenter once per week only if the pool still passes the safety and flow gates.
6. Collect sooner only when claimable fees exceed both five times the action cost and 0.5% of vault NAV.
7. Move collected excess to WETH. Do not automatically enlarge a token sleeve during the pilot.

The no-chase rule is the key. A narrow position earns a large share while flow remains near the entry price. Once price leaves the band, it stops converting inventory and stops paying fees. Repeatedly recentering into a falling token would turn fee harvesting into uncontrolled averaging down.

## Out-of-sample results

Each evaluation week used a disjoint preceding week for market-activity screening. Position return includes:

- exact swap direction and price path;
- active-liquidity dilution on every swap;
- the 5/6 LP fee share;
- inventory value at the final price;
- a 1% round-trip token-acquisition and liquidation allowance;
- two 0.000025 WETH management actions per position.

With each LP at 25% of vault NAV and 25% retained in WETH, modeled weekly vault returns were:

- week of 7 September: **+0.37%**;
- week of 14 September: **+9.33%**;
- week of 21 September: **+10.81%**.

The arithmetic mean was **+6.84% per week** and the geometric mean was **+6.74% per week**. The simple annualization of the arithmetic mean is approximately **356% APR**. That is a short historical observation, not a forecast or a public yield claim.

DELTA and GIWA were individually positive in all three evaluation weeks. PONGO lost 1.85% in the earliest week, then returned 6.31% and 33.94%; the equal-weight basket remained positive in every tested week.

## What did not work

- Selecting multiple pools by prior-week volume alone produced unstable baskets and a negative mean for five positions.
- Selecting the previous week's highest LP return or highest fee yield was strongly mean-reverting and lost heavily in the following week.
- Wider 25%–200% bands increased exposure to token inventory and failed during the earliest down regime.
- Current PONS v2 hook charges are not collectible by a normal external LP and must not be presented as HOODX yield.

The persistence screen therefore matters more than the headline APR. A new pool should not enter the fee-machine sleeve because it had one exceptional week.

## Admission and removal rules

A pool may enter the pilot only when all of these are true:

- canonical PONS v1 factory origin and canonical WETH pool;
- immutable 1% Uniswap v3 fee tier;
- standard PONS token bytecode family and expired launch restrictions;
- at least three consecutive complete weeks of data;
- positive corrected 10% band return in at least two of three weeks;
- positive equal-weight basket contribution over the same window;
- at least 25 unique swap senders per week;
- largest sender below 50% of swaps;
- at least 8% of swaps in the minority WETH direction;
- enough active liquidity for the proposed mint and unwind under a pre-trade impact cap.

Pause new liquidity immediately if canonical provenance changes, `feeProtocol` changes, recent swap collection is incomplete, the top sender exceeds 60%, active liquidity falls 50%, or a complete week cannot be reconstructed. Remove a pool after two consecutive weekly gate failures. Direct withdrawal must never depend on the scanner or fee collector.

## $200 pilot

At the initial size, use live ETH/USD only to translate the allocations:

- $50 WETH reserve;
- $50 DELTA/WETH LP;
- $50 PONGO/WETH LP;
- $50 GIWA/WETH LP.

The canary should run for four complete weeks with public deposits disabled. Promotion requires exact realized fee reconciliation, successful exit rehearsals on a local fork, no unbounded approvals, no manager path that can touch unrelated vault assets, and a positive lower confidence bound after realized gas and slippage.

## Evidence

Reproducible code:

- `research/launch_hunter_pons_v3_study.py`

Compact derived outputs:

- `research/launch_hunter_pons_v3_results/pons_v3_persistent_basket_weekly.csv`
- `research/launch_hunter_pons_v3_results/pons_v3_fee_validation.csv`
- `research/launch_hunter_pons_v3_results/*/pons_v3_static_outcomes.csv`
- `research/launch_hunter_pons_v3_results/*/pons_v3_static_summary.csv`

Raw archive observations and the private RPC credential remain outside version control. The research was read-only and sent no transaction.

Primary references:

- PONS protocol fees and locked-liquidity behavior: https://docs.ponsfamily.com/
- PONS v1 and v2 contract architecture: https://github.com/ponsdotdev/pons-labs
- Uniswap v3 concentrated-liquidity mechanics: https://uniswap.org/whitepaper-v3.pdf
- Loss-versus-rebalancing: https://arxiv.org/abs/2208.06046
