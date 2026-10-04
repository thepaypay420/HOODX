# HOODX Smart ETH vault: final design and validation (2026-10-04, pass 2)

**ETH in, ETH out. It rides ETH up to 1.75× while crypto trends up and steps into Robinhood Earn dollars when it breaks.**
Every rule runs on-chain from Chainlink prices, and anyone can crank it.
Scripts and data: `research/boost/backtest/` (Coinbase hourly ETH, BTC and SOL to 2026-10; Hyperliquid ETH funding 2023-05 → 2026-10).

## 1. The structure

| Layer | Choice | Why (evidence below) |
|---|---|---|
| Trend | 4 EMAs (20/50/100/200 days) of Chainlink ETH/USD, **averaged 50/50 with the same ensemble on Chainlink BTC/USD**, 1% hysteresis | BTC confirmation was the only structural variant that helped (§3.3); the walk-forward picked it independently from 2022 |
| Size | leverage = trend × min(1.75, 0.8 / σ̂), σ̂ = EWMA of hourly ETH returns with a 14-day half-life | Centre of a flat parameter plateau (§3.2) |
| Ceiling | **1.75× hard** (LTV ≤ 42.9% against 77% LLTV) | Same returns as 2× (§3.6); liquidation needs an instant −44% gap |
| Rebalance | Hourly permissionless `rebalance()`, band ±0.10, **sliced at ≤ $100k per hour** | Slicing is what makes $1M+ viable (§3.4) |
| Leverage source | Morpho Blue WETH→USDG market `0x7c820d6a09…` (Chainlink oracle, 0.05% APY now) + free Morpho flash loans | ETH perp longs paid 14.4% a year in funding on Hyperliquid |
| Swaps | Uniswap V3 USDG/WETH 0.01% ($25M liquidity), min-out bounded by Chainlink | Measured cost: 1.4 bp at $10k, 4 bp at $100k, 18 bp at $500k |
| Idle dollars | Robinhood Earn steakUSDG (7.1%, ERC-4626, no swap) | Adds about 2 points a year |
| Oracles | Chainlink ETH/USD `0x78F3556b…` and BTC/USD `0xa2c5184b…` on Robinhood Chain (0.5% deviation, 24h heartbeat) | Gating by the feed's real update rule costs nothing (§3.5) |
| Fees | 10% performance fee above a high-water mark | Included in every number below |

State is O(1): 8 EMAs, 1 variance and 8 hysteresis flags, updated by an hourly `poke()`. It needs no price history storage and leaves no keeper discretion.

## 2. Headline results (all costs included)

Settings: trades execute 1h after the signal; $250k vault; real pool impact; $100k slices; 5% borrow; 4% cash yield; 10% performance fee.

| | Vault | ETH held |
|---|---|---|
| 2016-10 → 2021 (design) | +198%/yr, worst drawdown −43%, Sharpe 2.03 | +192%/yr, −94%, 1.52 |
| **2022 → 2026-10 (never used to choose anything)** | **+33%/yr, −49%, Sharpe 0.79, 5.3× more ETH** | −7%/yr, −77%, 0.24 |
| Full 10 years | +103%/yr, −49%, Sharpe 1.49 | +70%/yr, −94%, 1.04 |
| Liquidations | 0 | — |

Average leverage is 0.6×. This is a smart ETH vault that levers only when it is paid to, not a permanent 2× token.
Constant 2× ETH lost 49% a year in 2022-26 and hit −100%.

## 3. Validation

**3.1 Other assets, identical settings.** Since 2022: BTC +47%/yr (dd −51%) vs hold +13% (−67%); SOL +46% (−58%) vs −7% (−95%).
Since 2016: BTC +111% vs +64%. The rule was designed only on ETH 2016-21.

**3.2 Parameter surface.** 108 combinations (vol target 0.8-1.4, cap 1.5-2.5, vol half-life 7-30 days, band 0.10-0.40) on ETH
(both periods), BTC and SOL. Every combination beat holding on every asset. Mean Sharpe spans only 1.11-1.31. Bands of 0.10-0.25
beat 0.40; the cap barely matters.

**3.3 Structural variants.** Tested against the base on all four cases:

| Variant | Verdict |
|---|---|
| Minimum coin floor | Rejected |
| Drawdown brakes | Rejected (worse Sharpe) |
| Convex or concave trend scoring | Rejected (neutral) |
| Five spans | Rejected (neutral) |
| 1% hysteresis | Kept (neutral returns, fewer whipsaws, slightly smaller drawdowns) |
| **BTC confirmation** | **Kept** (ETH test +32% → +38%, SOL +42% → +51%) |

**3.4 Capacity.** Calibrated to live quotes (2022-26):

| TVL | Unsliced | $100k slices |
|---|---|---|
| $50k | +36%/yr | +36%/yr |
| $250k | +30% | +28% |
| $1M | +9% | **+22%** |
| $3M | −34% | **+17%** |
| $10M | −89% | +12% |

Launch cap $1M. Morpho's free USDG ($45k) also caps borrowing until lenders arrive; a 100% borrow rate above that still leaves +20%.

**3.5 Execution realism (2022-26)**

| Friction | Result |
|---|---|
| 1h trade delay | Free |
| Keeper every 4h | −1 pt |
| Keeper daily | −12 pts (so hourly) |
| 3h delay | −6 pts |
| Chainlink's real update rule (0.5% move or 24h) | −2 pts |

**3.6 Walk-forward.** Re-optimising every year on past data (×92 over 2019-26) did no better than the fixed design (**×94**; ETH ×20). There is
nothing to gain from tuning, which is the sign of a design that is not fitted to its history.

**3.7 What a depositor experiences.** Weekly entry dates since 2017:

| | 1-year hold | 2-year hold |
|---|---|---|
| Chance of a loss | **15%** (ETH 44%) | **2%** (ETH 36%) |
| Worst case | **−44%** (ETH −91%) | **−16%** (ETH −88%) |
| Median | +57% (ETH +25%) | +150% (ETH +47%) |
| Beat ETH | 76% of entries | 87% of entries |

**3.8 Monte Carlo.** 300 synthetic 4-year paths from paired 30-day ETH/BTC blocks:

| | Vault | ETH |
|---|---|---|
| Median CAGR | +73% | +71% |
| 10th percentile | **+12%** | −14% |
| 5th percentile | **−2%** | −30% |
| Chance of a 4-year loss | **6%** | 15% |
| Liquidations | 0 | — |

Month blocks cut long trends, so this understates the strategy. Its value shows up in the tails.

**3.9 Stress**
- **Keeper outage of 24-72h** starting at the crash hour of six real crashes (COVID, May 2021, LUNA, FTX, Aug 2024, Oct 2025): no liquidations.
  The worst extra loss was in the FTX week (−25% vs −11% with the keeper running).
- **Instant gaps:**

  | Instant gap | Equity at 1.5× | Equity at 1.75× |
  |---|---|---|
  | −25% | −38% | −44% |
  | −30% | −45% | −53% |
  | −40% | −60% | −70% |
  | −50% | −75% | −93% (liquidated) |

  At 1.75× liquidation starts at a −44% instant gap; at 1.5×, at −57%.

  The worst real one-hour fall in 10 years was −28.8% (Mar 2017); since 2018 it was −26.6% (May 2021).
- **Borrowing.** No borrowing at all still gives +20%/yr, as does a 100% borrow rate above $45k of debt.

## 4. Contract outline (same format as AutoLP V2 and the Night LP vault)

- **`deposit(ETH)`:** NAV from Chainlink. The deposit mirrors the vault's current mix in the same transaction (flash loan → buy WETH → supply → borrow,
  or a part to steakUSDG), and the depositor pays their own swap costs, so holders are never diluted.
- **`withdraw(shares)`:** a pro-rata unwind in one transaction (flash repay → withdraw collateral → redeem steakUSDG → swap → ETH). Never blocked by pause.
  `withdrawInKind` returns WETH and steakUSDG with the debt share settled.
- **`poke()` (anyone, hourly):** reads both feeds (fresh within heartbeat plus margin, and sane), then updates the EMAs, flags and variance.
  The seed state is set at deploy from published history and is verifiable off-chain.
- **`rebalance()` (anyone):** the contract computes the target and the slice (≤ $100k); swaps are bounded by Chainlink ± max slip. Above 1.75× anyone may cut at once.
- **Curator:** may pause deposits; holds no parameter or fund powers. Fork tests and an audit pass as for the earlier vaults.

## 5. Honest limits

- It lags straight-up rallies (2021: +211% vs +400%; 2023: +75% vs +91%) and earns its keep by sidestepping crashes.
- The median Monte Carlo outcome equals ETH. The case for the vault is the far better downside, not a higher average.
- Capacity is about $1-3M at the current pool depth and Morpho liquidity.
- These are backtests; the contract still has to be built, fork-tested and audited.
