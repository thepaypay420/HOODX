# HOODX blue-chip crypto LP basket research

**Snapshot:** 28 September 2026

**Scope:** Robinhood Chain, WETH/USDG concentrated-liquidity venues, 30 trailing days

**Status:** Research design. No live transaction, adapter activation, or public yield claim is authorized by this document.

## Decision

Build the first crypto LP pilot around **WETH/USDG**, with deep Uniswap pools as the permanent core and two strictly capped fee-density satellites. Robinhood Chain does not currently have a WBTC, liquid-staked ETH, LINK, AAVE, UNI, SOL, or AVAX pool with enough verified liquidity to justify inclusion. Calling a thin or synthetic token “blue chip” would create risk without useful diversification.

The recommended protocol-controlled pilot is:

| Sleeve | Weight | Role | Initial cap at a $10,000 pilot |
|---|---:|---|---:|
| Uniswap v3 WETH/USDG 0.01% | 50% | Deep core liquidity | $5,000 |
| Uniswap v3 WETH/USDG 0.05% | 20% | Higher-fee core | $2,000 |
| Up v3 WETH/USDG 0.05% | 15% | Tactical fee-density satellite | $1,500 |
| Ramses v3 WETH/USDG 0.01% | 5% | Small venue-diversification satellite | $500 |
| Liquid USDG | 10% | Operations and withdrawal reserve | $1,000 |

The pilot should be capped at **$10,000 initially**. The binding measured limit is Up v3: a 15% sleeve reaches its 0.5%-of-active-liquidity guard at approximately $11,800 of total basket capital. Do not scale from TVL alone.

## Expected yield

The useful underwriting range is **14.1% to 22.7% modeled net fee APY**, using the latest seven-day volume run rate and assuming the strategy captures only 10% to 15% of the raw historical fee opportunity. The 15% capture case equals **1.70% modeled net fee income per month**, or **22.7% if compounded for a year**. A more optimistic 25% capture case reaches 2.93% per month and 42.0% compounded APY, but this is an upside case and should not be marketed as expected yield.

Yield and total return are different. In the latest-volume 15% capture case, the modeled basket returned 3.52% during the observed ETH rally while the passive starting token mix returned 4.06%. It underperformed passive holding by 0.52 percentage points because impermanent loss exceeded part of the fee income. At 25% fee capture, the basket outperformed the passive mix by 0.67 points. The strategy therefore needs about 20% realized fee capture at the current run rate to beat passive WETH/USDG over this particular price path.

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

Use a **geometric ±5% range**, require **12 consecutive hours** near an outer edge before moving it, permit at most **one re-band every seven days**, and evaluate compounding weekly. In the 30-day path this policy remained active 96.4% of the time and re-banded once.

The production policy should be deterministic:

1. Observe pool state, realized fee growth, range utilization, USDG peg references, and executable exit liquidity hourly.
2. Compound only when incremental fees cover every transaction and swap cost by at least 4x.
3. Use incoming deposits, fees, and withdrawals to reduce allocation drift first.
4. Re-band only after the 12-hour persistence test, a successful simulation, a fresh oracle check, and the seven-day cooldown.
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
- Enforce the $10,000 pilot cap and per-venue caps on-chain or in the guarded execution module.
- Run the pilot with protocol capital through at least two full re-band decisions and one forced satellite-disable exercise.

Until those gates pass, deploy the shape as **70% Uniswap 0.01%, 20% Uniswap 0.05%, and 10% liquid USDG**. That safer version modeled about 0.55% monthly net fee income at a 10% fee-capture assumption and the latest volume run rate, or roughly 6.9% compounded APY. The higher-yield 14%-23% range requires the guarded satellites.

## Method and limits

The study used hourly pool OHLCV and volume arrays for the 30 days ending 28 September 2026. Empty hours were restored with zero volume and the previous close, following CoinGecko's documented OHLCV convention. The simulator valued a $10,000 concentrated-liquidity position hourly, attributed fees by modeled share of active liquidity, applied fixed and proportional management costs, and compared the result with the position's starting token mix held passively.

The active-liquidity snapshot was frozen at 22:07 UTC on 28 September so the results are reproducible. Historical active liquidity was unavailable, so the model holds that snapshot constant across the month. That is a material limitation. Production eligibility must use realized on-chain fee growth and archive-quality liquidity history. APYs are mathematical annualizations of one month, not forecasts or guarantees.

Sources: [Robinhood Chain documentation](https://docs.robinhood.com/chain/), [CoinGecko pool OHLCV specification](https://docs.coingecko.com/reference/pool-ohlcv-contract-address), [Uniswap concentrated-liquidity overview](https://support.uniswap.org/hc/en-us/articles/7425482965517-Uniswap-v2-v3-and-v4), [Uniswap impermanent-loss explanation](https://support.uniswap.org/hc/en-us/articles/20904453751693-What-is-Impermanent-Loss), and [Uniswap out-of-range behavior](https://support.uniswap.org/hc/en-us/articles/7423614928909-Do-I-get-liquidated-if-the-price-goes-outside-of-my-range).
