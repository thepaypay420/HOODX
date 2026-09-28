# HOODX blue-chip crypto LP basket research

**Snapshot:** 28 September 2026

**Scope:** Robinhood Chain, WETH/USDG concentrated-liquidity venues, 30 trailing days

**Status:** Research design. No live transaction, adapter activation, or public yield claim is authorized by this document.

## $200 pilot decision

Build the first crypto LP pilot around **WETH/USDG**, with one deep Uniswap position, one strictly guarded fee-density position, and liquid USDG. Robinhood Chain does not currently have a WBTC, liquid-staked ETH, LINK, AAVE, UNI, SOL, or AVAX pool with enough verified liquidity to justify inclusion. Calling a thin or synthetic token “blue chip” would create risk without useful diversification.

At $200, four LP positions create unnecessary fixed costs. The optimized protocol-controlled pilot is:

| Sleeve | Weight | Dollars | Role |
|---|---:|---:|---|
| Uniswap v3 WETH/USDG 0.01% | 50% | $100 | Deep core liquidity |
| Up v3 WETH/USDG 0.05% | 40% | $80 | Guarded fee-density satellite |
| Liquid USDG | 10% | $20 | Operations and withdrawal reserve |

The extra Uniswap fee tier and Ramses become useful later, when the capital saved through venue diversification exceeds the cost of another position. For the $200 canary, simplicity produces the better net result.

## Micro-pilot cadence

Use two operating modes:

### Wide default

- Uniswap core: geometric ±30% range.
- Up satellite: geometric ±20% range.
- No scheduled re-band or standalone compound.
- Accrued fees remain with the strategy until a user flow or required range move can redeploy them economically.

At the 15% fee-capture assumption, this mode required no management transaction, produced $1.65 of modeled monthly net fee income, and was effectively even with passive holding after impermanent loss: -0.02 percentage points.

### Guarded tight mode

- Uniswap core remains at ±30%.
- Up satellite moves to ±7.5% only while its trailing realized fee density passes the economic gate.
- Require 24 continuous hours near the range edge.
- Permit at most one re-band every 30 days.
- Do not execute a standalone compound. Reinvest only during a required re-band or user-funded flow.
- Before signing a re-band, projected fees for the next management window must cover its complete estimated cost by at least 4x.

At the 15% fee-capture assumption, guarded tight mode made one re-band, spent $0.83 on management, produced $2.86 of modeled net monthly fee income, and beat the passive starting mix by 0.19 percentage points. Its modeled net fee APY was 18.8%.

The old frequent cadence made two re-bands and two compounds, spent $2.19, and underperformed passive holding by 0.26 points. It is rejected for the $200 pilot even though it displayed more gross fee income.

## Expected yield

For the $200 pilot, the useful guarded-tight range is **10.3% to 18.8% modeled net fee APY**, using the latest seven-day volume run rate and assuming the strategy captures 10% to 15% of the raw historical fee opportunity. The 15% capture case equals **1.43% modeled net fee income per month**, or $2.86. A more optimistic 25% capture case reaches 2.67% per month and 37.8% compounded APY, but this is an upside case and should not be marketed as expected yield.

Yield and total return are different. In guarded-tight mode, the latest-volume 15% capture case returned 4.26% during the observed ETH rally while the passive starting token mix returned 4.06%. At 10% fee capture it underperformed by 0.40 points; at 25% it outperformed by 1.39 points. The tight satellite therefore stays off unless its live fee-growth check supports the 4x cost gate.

## Why a basket is better than one LP

A single LP forces users to accept one venue's liquidity, fee tier, smart-contract risk, and traffic cycle. HOODX can create a better product by separating jobs:

- Deep Uniswap positions provide capacity and dependable exits.
- Small satellites harvest unusually dense fees without becoming exit-critical.
- The liquid USDG sleeve keeps maintenance and withdrawals independent from any one pool.
- Deposits and withdrawals rebalance the basket before an active swap is considered.
- A failing satellite can be isolated while the healthy core continues to operate.

This is venue and execution diversification, not crypto-price diversification. Every LP sleeve is still economically exposed to ETH and USDG.

## Venue evidence

| Venue | TVL | 30-day volume | Full-pool gross fee APR | Latest 7d volume vs prior period | Safe position cap | Result |
|---|---:|---:|---:|---:|---:|---|
| Uniswap v3 0.01% | $19.86m | $15.20bn | 93.2% | -40.9% | $59.5k | Core |
| Uniswap v3 0.05% | $5.67m | $649.1m | 69.6% | -27.3% | $14.6k | Core |
| Ramses v3 0.01% | $673k | $692.4m | 125.1% | -58.1% | $910 | 5% satellite only |
| Up v3 0.05% | $300k | $625.4m | 1,268.4% | -51.6% | $1.77k | 15% satellite only |
| Sushi v3 0.05% | $1.67m | $58.7m | 21.4% | +32.2% | $11.6k | Yield too low after haircut |
| Alandale CL 0.006% | $221k | $174.6m | 57.6% | +60.6% | $2.21k | Negative excess return |
| Giga v3 0.005% | $194k | $50.2m over 18.5 days | 25.6% | +12.5% | $1.94k | Negative excess return |

The satellite headline APRs are not portfolio APYs. They are raw volume multiplied by fee tier and divided by pool TVL. They ignore competition inside the active range, inactive hours, impermanent loss, re-band costs, protocol fees, incentives ending, and capacity.

## Management policy

The earlier $10,000 study favored a ±5% range with a seven-day cooldown. That cadence does not transfer to $200 because fixed execution costs consume too much of each sleeve. The micro-pilot uses the wide-default and guarded-tight rules above.

The production policy should be deterministic:

1. Observe pool state, realized fee growth, range utilization, USDG peg references, and executable exit liquidity hourly.
2. Compound only when incremental fees cover every transaction and swap cost by at least 4x.
3. Use incoming deposits, fees, and withdrawals to reduce allocation drift first.
4. Re-band only after the 24-hour persistence test, a successful simulation, a fresh oracle check, the 30-day cooldown, and the 4x economic gate.
5. Reduce a satellite when its 14-day realized net fee yield falls below the Uniswap core after costs.
6. Never increase a satellite above 0.5% of measured active liquidity, 1% of pool TVL, or its fixed portfolio cap.
7. Restore the 10% USDG reserve before increasing any LP position.

No AI agent should have discretionary custody or an unrestricted transaction path. An agent may recommend a move; contracts and deterministic policy must enforce the bounds.

## Robustness results

The Up satellite produced positive excess return in all three chronological ten-day folds under the 75% fee haircut: +9.40%, +6.64%, and +1.12%. The declining sequence and 51.6% recent-volume drop show why it must remain small. Ramses produced +3.68%, +1.54%, then -0.51%, with a 58.1% recent-volume drop.

The Uniswap core was much steadier in capacity but did not beat passive holding in every fold. The 0.01% pool's fold excess was +1.29%, -0.43%, and -1.82%. Its job is capacity, execution quality, and resilience; the satellite sleeves supply the higher fee density.

## Required gates before capital

The two Uniswap pools use the reviewed model assumptions. Up v3 and Ramses remain **UNVERIFIED adapters** and are launch blockers until all of the following pass:

- Verify factory, pool bytecode, fee accounting, callback semantics, position ownership, collect, decrease-liquidity, and emergency-exit paths.
- Reproduce fee growth from on-chain position state; do not pay or market yield from GeckoTerminal volume estimates.
- Fork-test mint, compound, re-band, partial withdrawal, full withdrawal, a pool revert, stale oracle, depeg, fee-on-transfer behavior, and unavailable liquidity.
- Prove that a failed Up or Ramses operation cannot block Uniswap withdrawals or direct token redemption.
- Enforce the $200 pilot cap and per-venue caps on-chain or in the guarded execution module.
- Run the pilot with protocol capital through at least two full re-band decisions and one forced satellite-disable exercise.

Until those gates pass, deploy the shape as **70% Uniswap 0.01%, 20% Uniswap 0.05%, and 10% liquid USDG**. That safer version modeled about 0.55% monthly net fee income at a 10% fee-capture assumption and the latest volume run rate, or roughly 6.9% compounded APY. The higher-yield 14%-23% range requires the guarded satellites.

## Method and limits

The study used hourly pool OHLCV and volume arrays for the 30 days ending 28 September 2026. Empty hours were restored with zero volume and the previous close, following CoinGecko's documented OHLCV convention. The venue screen used a $10,000 normalized position for comparable capacity estimates. The final cadence study used the actual $200 portfolio and actual sleeve dollar amounts, attributed fees by modeled share of active liquidity, applied fixed and proportional management costs, and compared the result with the position's starting token mix held passively.

The active-liquidity snapshot was frozen at 22:07 UTC on 28 September so the results are reproducible. Historical active liquidity was unavailable, so the model holds that snapshot constant across the month. That is a material limitation. Production eligibility must use realized on-chain fee growth and archive-quality liquidity history. APYs are mathematical annualizations of one month, not forecasts or guarantees.

Sources: [Robinhood Chain documentation](https://docs.robinhood.com/chain/), [CoinGecko pool OHLCV specification](https://docs.coingecko.com/reference/pool-ohlcv-contract-address), [Uniswap concentrated-liquidity overview](https://support.uniswap.org/hc/en-us/articles/7425482965517-Uniswap-v2-v3-and-v4), [Uniswap impermanent-loss explanation](https://support.uniswap.org/hc/en-us/articles/20904453751693-What-is-Impermanent-Loss), and [Uniswap out-of-range behavior](https://support.uniswap.org/hc/en-us/articles/7423614928909-Do-I-get-liquidated-if-the-price-goes-outside-of-my-range).
