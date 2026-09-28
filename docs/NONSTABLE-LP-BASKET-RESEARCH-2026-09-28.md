# HOODX non-stable LP basket: robust portfolio study

Study window: 2026-08-29 18:00 UTC through 2026-09-28 17:00 UTC.

Status: **research candidate for a protocol-controlled pilot**. This is not a production launch approval or a forecast.

Updated status after the adversarial sequence test: **shadow canary first; public capital is blocked** until the post-incentive promotion gates pass.

## Decision

The adversarial pass changed the highest-confidence **pilot** basket to:

- 35% WETH/USDG, Uniswap v3, 0.01%
- 15% NVDA/USDG, Uniswap v3, 0.05%
- 20% QQQ/USDG, Uniswap v3, 0.05%
- 10% AAPL/USDG, Uniswap v3, 0.05%
- 20% USDG reserve outside LP positions

This is a barbell: WETH supplies the deepest crypto fee engine; NVDA supplies a high-volume equity sleeve; QQQ reduces single-company concentration; AAPL has the lowest observed correlation to the other chosen sleeves but is capped because its pool is smaller. USDG funds exits, failed-position recovery, and flow-based rebalancing.

The first 45/20/15/10/10 mix ranked only 32nd of 44 nearby weight combinations when the score emphasized the worst ten-day fold and drawdown. The revised weights ranked first. This is a meaningful anti-overfitting improvement: the recommendation now sits in a cluster of similar low-risk mixes rather than at the highest-return point.

The basket is not selected because it had the highest one-month return. WETH alone returned more during this rising month. The basket is selected because it retained upside while materially reducing dependence on one price path, one LP range, and one position-manager operation.

## Measured result

Under a 50% haircut to modeled fees, the revised pilot returned:

- Basket return: 3.56%
- Passive starting-token mix: 2.69%
- LP excess over passive: 0.85%
- Maximum drawdown: 1.77%
- Annualized realized volatility: 9.57%
- Worst observed day: 1.12%

Under a severe 75% haircut to modeled fees, the revised pilot returned:

- Basket return: 2.72%
- Passive starting-token mix: 2.69%
- LP excess over passive: 0.033%
- Maximum drawdown: 1.88%
- Annualized realized volatility: 9.54%
- Worst observed day: 1.15%

The severe case is mostly underlying-asset beta, not proven LP alpha. Fee capture had to retain about **24.5% of the raw historical pro-rata estimate**, or 98% of the already-severe case, merely to break even versus the passive token mix. That is too thin to market as proven yield. The protocol-controlled canary can proceed only as a capped learning product after fresh post-subsidy observation.

## Sequence sensitivity: the apparent LP edge does not survive

Sixty synthetic 30-day paths resampled aligned 24-hour blocks across all four assets. The same block was used for every sleeve, preserving observed cross-asset dependence; prices were rebuilt continuously so block boundaries did not create artificial jumps. Policies and weights stayed fixed.

Under the 75% fee haircut:

- Total basket return: -2.49% at the 5th percentile, +1.71% median, +4.18% at the 95th percentile.
- Maximum drawdown: -4.79% at the adverse 5th percentile and -2.30% median.
- LP excess versus passive holdings: -2.94% at the 5th percentile, -1.04% median, and **-0.14% even at the 95th percentile**.

Every resampled path had negative LP excess. This does not predict future returns—the bootstrap can only reorder the observed regime—but it proves the original near-zero positive excess is not sequence-robust. The launch plan therefore changes:

1. Run the positions in shadow mode with no public capital through at least 30 complete post-waiver days.
2. Re-estimate historical active tick liquidity and exact fee growth using archive data.
3. Permit a protocol-funded canary of at most $10,000 only if realized net LP excess is positive and remains positive after a further 25% fee decline.
4. Raise the cap toward $25,000 only after a second consecutive passing window and successful failure-isolation drills.

## Breakthrough finding: the APR traps are identifiable

The expanded screen found several pools that look irresistible by trailing return or gross APR but fail basic tail tests:

- TSLA/USDG returned 8.36% in RangeScout's 63-day backtest, but its reported Monte Carlo 5th-percentile/median/95th-percentile band was -60% / -15% / +26%. Reject for v1.
- WETH/SPY returned 15.84%, but its entire reported band was negative: -88% / -68% / -22%. Reject.
- WETH/NVDA returned 1.57%, but its band was -79% / -32% / +26%. Reject the volatile/volatile structure for v1.
- WETH/MSTR lost 54.70%; every tested range lost money. Reject.
- WETH/USDG's external band was +9% / +10% / +11%; NVDA/USDG's was +1% / +4% / +11%. These support using a deep stable quote and capped independent sleeves.

The resulting edge is an **anti-APR admission engine**. A pool cannot enter because it tops a yield table. It must survive a fee haircut, an adverse external simulation band, capacity checks, stale-reference handling, and a portfolio-level concentration test.

These external simulations use a different methodology and window from the HOODX model. They are corroborating evidence, not merged observations.

## Incubation lane: promising, not ready

The wider discovery pass found four pools worth continued measurement. Three were replayed through the same HOODX severe-fee model with independently selected bounded policies:

- **MU/USDG:** 4.77% severe-case return, but -0.92% full-path excess versus passive holdings. All three reset folds showed positive excess. That disagreement signals path dependence, so MU remains a watch candidate.
- **SLV/USDG:** only 0.15% severe-case return, but +4.48% versus a falling passive token mix. Its 6.42% drawdown and one negative excess fold are too large for the first canary. It is the most interesting future diversifier.
- **DELL/USDG:** 10.10% severe-case return, but passive holdings returned slightly more; volatility was 36.08% and drawdown 6.70%. This is asset beta wearing an LP label, so it is rejected for v1.
- **AMZN/USDG:** RangeScout's 51-day result and adverse band were positive, while HOODX's latest 30-day window was negative. The regime conflict keeps it in observation.

This creates a clean two-stage system. The live canary uses only the high-confidence core. An incubator runs the same read-only measurements on candidates and promotes one only after two consecutive post-subsidy windows pass the fee-decay, fold, capacity, and oracle gates. No curator intuition or AI score can skip those gates.

## Where the basket beats a single LP

The severe-fee WETH-only policy returned 4.92%, but had a 3.51% maximum drawdown and 19.76% realized volatility. The revised basket gave up raw return while reducing drawdown by about 46% and volatility by about 52%.

The severe-fee NVDA-only policy returned 2.81% with a 4.11% drawdown. The revised basket returned 2.72% with a 1.88% drawdown. It nearly matched return while cutting drawdown by about 54%.

The original mix's three ten-day folds were all positive under the severe fee haircut, but LP excess over passive was slightly negative in two. The weight-robustness pass therefore did not optimize on total return. It promoted the nearby mix with the best combination of worst-fold excess and drawdown.

This is the honest edge over a Krystal-style single-position workflow: the basket smooths position-specific outcomes and packages several independently managed fee engines into one redeemable token. It did not beat the best single LP on absolute return in this one market regime.

## How overfitting was constrained

The study did not optimize hundreds of custom thresholds or portfolio weights.

- The management search used only four range widths, two persistence windows, two cooldowns, and two compound cadences.
- Policies were ranked under a 75% fee haircut.
- Every policy was evaluated on three separate ten-day folds.
- A candidate needed at least 90% full-period uptime, at least 85% uptime in every fold, no more than two re-bands in a fold, and no more than five over the month.
- The first basket weights were fixed from liquidity capacity, correlation, and role. A second pass tested 44 nearby mixes at coarse 5-point increments, with strict sleeve and reserve bounds.
- The revised mix was selected using worst-fold excess and drawdown, not full-period return.
- The original mix, all neighbors, and the selection score remain in the output so the choice is auditable.
- The 50% and 75% fee cases reuse the exact same assets, weights, ranges, and cadence.

The evidence is still one month on a new chain. It is a robust canary design, not proof across a full market cycle.

## Sleeve policy

### WETH/USDG — 35%

- Range: ±10% geometric
- Edge persistence: 12 hours
- Re-band cooldown: 72 hours
- Compound check: weekly
- Role: deepest fee engine and primary return sleeve

The 24-hour and 72-hour cooldowns produced the same observed full-month path. The pilot uses 72 hours because it limits unseen churn without sacrificing the captured result.

### NVDA/USDG — 15%

- Range: ±10%
- Edge persistence: four hours, but only while the underlying reference is fresh
- Re-band cooldown: 24 hours
- Compound check: weekly
- Role: high-volume equity fee sleeve

### QQQ/USDG — 20%

- Range: ±10%
- Edge persistence: four hours with a fresh underlying reference
- Re-band cooldown: 24 hours
- Compound check: weekly
- Role: diversified equity beta with lower observed volatility

### AAPL/USDG — 10%

- Range: ±25%
- Edge persistence: four hours with a fresh underlying reference
- Re-band cooldown: 24 hours
- Compound check: weekly
- Role: correlation diversifier and high-turnover satellite

The wider range is deliberate. AAPL's pool is much smaller, and the narrow high-return fit depended more heavily on the observed path. The robust fold selection preferred the wider position. At a $25,000 basket seed, the AAPL sleeve is $2,500, below 1% of the captured $339,798 pool TVL.

## The product edge over Krystal

Krystal provides strong tooling for managing one position: trigger prices, time buffers, fee minimums, gas ceilings, slippage controls, compounding, and rebalancing. HOODX should preserve those safeguards and add a portfolio layer.

### One share token, several fee engines

A user deposits once and receives a fungible index share backed by multiple LP positions plus reserve. The user does not select four pools, maintain four NFTs, or decide which position needs attention.

### Flow-based rebalancing before trading

New deposits, accumulated fees, and reserve refills go to underweight sleeves first. The protocol sells an overweight sleeve only when cash flows cannot restore the band. This lowers unnecessary turnover and distinguishes portfolio management from four independent auto-rebalancers.

### Cross-sleeve harvest and netting

One atomic curator action can collect fees from every healthy sleeve, refill reserve, and deploy only the remainder. Small fee balances are aggregated before spending gas or taking swap loss. A failing sleeve is skipped rather than blocking collection or withdrawal from unrelated sleeves.

### Portfolio-level risk budget

The basket enforces limits that a single-position tool cannot:

- Maximum 50% in one underlying LP
- Maximum 35% total in single-company stock-token sleeves
- Minimum 20% directly withdrawable USDG reserve during the canary
- Maximum 0.5% of active liquidity and 1% of pool TVL per sleeve
- Maximum one portfolio re-band action in 24 hours
- Maximum two sleeve changes per atomic action during the canary

### Portfolio recommendation, not APR sorting

The recommended card should optimize fee capture per unit of drawdown and liquidity risk. A high nominal APR from a small or subsidized pool is not automatically admitted.

## Programmatic management

Run a read-only health check hourly. Transactions are event-driven.

1. Validate canonical token addresses against Robinhood's live asset registry.
2. Require pool spot, TWAP, and the stock token's Chainlink reference to agree within the configured tolerance.
3. Refuse equity sleeve re-bands when the reference is stale or the underlying trading/tokenization window cannot support reliable arbitrage.
4. Re-band only after the sleeve-specific persistence and cooldown rules pass.
5. Require projected 30-day incremental fees to exceed complete execution costs by at least 4×.
6. Compound only when collected fees exceed costs by at least 4× and exceed 0.05% of that sleeve.
7. Route fees and new deposits to underweight sleeves before executing a sale.
8. Simulate the complete atomic action immediately before signature with pinned pools, ticks, minimums, deadline, and resulting portfolio weights.

The system should make deterministic recommendations. An AI can explain the recommendation or identify an anomaly, but it should not have discretion to bypass the rules.

## Failure and decay results

The fee-volume survival curve is the most important negative result. With no credited fees, the original mix lagged passive holdings by 0.96%. At 50% of the severe-case fee volume it still lagged by 0.47%. It crossed zero LP excess only at 98% of the severe-case assumption. The pilot therefore needs a promotion gate based on live post-subsidy data rather than a projected APR.

A complete fee outage in one sleeve did not make the combined path insolvent in this model. It reduced full-period excess versus passive by:

- 0.71 percentage points for WETH, the critical fee engine
- 0.19 points for NVDA
- 0.05 points for QQQ
- 0.03 points for AAPL

This is an economics test, not a contract-liveness proof. The implementation still must skip an unhealthy sleeve and preserve direct recovery without requiring that sleeve's router, oracle, or position manager.

Promotion from canary requires all of the following over a fresh rolling 30-day period after incentives normalize:

1. Realized net LP excess remains positive after gas, swap loss, and management costs.
2. Modeled fee capture can fall another 25% from the observed post-subsidy level without making projected excess negative.
3. No single sleeve supplies more than 60% of projected portfolio fees.
4. Every sleeve passes a forced zero-fee and direct-recovery drill on a local fork.
5. The 20% reserve has covered observed redemptions and maintenance without forced selling.

## Capacity and launch gates

- Shadow phase: no public capital.
- First protocol-funded seed after promotion gates: at most $10,000.
- Second-stage hard cap: $25,000 because AAPL is the limiting pool.
- Require 30 days of post-gas-waiver volume before treating reported fee turnover as durable.
- Use archive RPC/indexed data to replace the current-active-liquidity approximation with historical tick liquidity and exact fee growth.
- Verify every stock-token contract against Robinhood's canonical registry.
- Fork-test deposit, fee collection, flow rebalance, range rebalance, partial withdrawal, full withdrawal, one-sleeve failure, stale oracle, router outage, and direct recovery.
- Prove that one reverting position manager or token cannot block unrelated withdrawals.
- Keep direct pro-rata asset withdrawal independent from pricing, routers, automation, and backend services.

## Exclusions

- GLD: excluded because both captured pools showed a roughly 68% price discontinuity that must be reconciled with corporate-action multipliers and oracle history.
- AMZN: high nominal fee tier, but negative full-period asset performance, higher volatility, and weak robust score.
- SPY: stable and useful as a future defensive alternate, but lower fee contribution and substantial overlap with QQQ in this first four-sleeve basket.
- WETH/USDG 0.05%: viable failover, but the 0.01% venue had slightly better robust economics and much more liquidity.

## Reproducibility

Run:

```text
python research/nonstable_lp_portfolio_study.py
python research/nonstable_lp_breakthrough_study.py
```

Primary outputs:

- `research/nonstable_lp_results/recommended_nonstable_basket.json`
- `research/nonstable_lp_results/portfolio_fold_results.csv`
- `research/nonstable_lp_results/robust_policies.json`
- `research/nonstable_lp_results/asset_daily_return_correlations.csv`
- `research/nonstable_lp_results/portfolio_value_series.csv`
- `research/nonstable_lp_results/breakthrough_robustness_summary.json`
- `research/nonstable_lp_results/weight_robustness_frontier.csv`
- `research/nonstable_lp_results/fee_volume_survival.csv`
- `research/nonstable_lp_results/sleeve_fee_outages.csv`
- `research/nonstable_lp_results/external_pool_admission_screen.csv`
- `research/nonstable_lp_results/incubator_pool_scan.csv`
- `research/nonstable_lp_results/correlated_block_bootstrap.csv`

## Sources

- GeckoTerminal hourly Robinhood Chain pool OHLCV and current pool metadata.
- RangeScout Robinhood Chain pool methodology and subsidy warning: https://api.rangescout.app/robinhood-chain-liquidity-pools/
- Krystal auto-rebalance documentation: https://docs.krystal.app/products/liquidity-management/lp-transactions/auto-rebalance
- Krystal compound documentation: https://docs.krystal.app/products/liquidity-management/lp-transactions/compound
- Uniswap concentrated-liquidity documentation: https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/concentrated-liquidity
- Robinhood canonical stock-token contracts: https://docs.robinhood.com/chain/contracts/
- Robinhood stock-token price-feed and trading-window documentation: https://docs.robinhood.com/chain/stock-tokens/
