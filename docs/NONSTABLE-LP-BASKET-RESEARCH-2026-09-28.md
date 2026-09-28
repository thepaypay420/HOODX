# HOODX non-stable LP basket: robust portfolio study

Study window: 2026-08-29 18:00 UTC through 2026-09-28 17:00 UTC.

Status: **research candidate for a protocol-controlled pilot**. This is not a production launch approval or a forecast.

## Decision

The highest-confidence non-stable LP basket from the available Robinhood Chain history is:

- 45% WETH/USDG, Uniswap v3, 0.01%
- 20% NVDA/USDG, Uniswap v3, 0.05%
- 15% QQQ/USDG, Uniswap v3, 0.05%
- 10% AAPL/USDG, Uniswap v3, 0.05%
- 10% USDG reserve outside LP positions

This is a barbell: WETH supplies the deepest crypto fee engine; NVDA supplies a high-volume equity sleeve; QQQ reduces single-company concentration; AAPL has the lowest observed correlation to the other chosen sleeves but is capped because its pool is smaller. USDG funds exits, failed-position recovery, and flow-based rebalancing.

The basket is not selected because it had the highest one-month return. WETH alone returned more during this rising month. The basket is selected because it retained upside while materially reducing dependence on one price path, one LP range, and one position-manager operation.

## Measured result

Under a 50% haircut to modeled fees:

- Basket return: 4.32%
- Passive starting-token mix: 3.26%
- LP excess over passive: 1.03%
- Maximum drawdown: 2.16%
- Annualized realized volatility: 11.52%
- Worst observed day: 1.36%

Under a severe 75% haircut to modeled fees:

- Basket return: 3.28%
- Passive starting-token mix: 3.26%
- LP excess over passive: 0.027%
- Maximum drawdown: 2.30%
- Annualized realized volatility: 11.50%
- Worst observed day: 1.40%

The severe case is mostly underlying-asset beta, not proven LP alpha. That distinction is a launch requirement: market the product as a managed diversified LP index, not as a guaranteed high-yield product.

## Where the basket beats a single LP

The severe-fee WETH-only policy returned 4.92%, but had a 3.51% maximum drawdown and 19.76% realized volatility. The basket gave up 1.64 percentage points of raw return while reducing drawdown by about 34% and volatility by about 42%.

The severe-fee NVDA-only policy returned 2.81% with a 4.11% drawdown. The basket returned 3.28% with a 2.30% drawdown, so it beat the strongest individual stock sleeve on both return and drawdown.

All three ten-day basket folds were positive under the severe fee haircut: 0.97%, 1.12%, and 1.42%. LP excess over the passive starting mix was 0.34%, -0.015%, and -0.067%. Under the 50% fee haircut, excess was positive in every fold: 0.77%, 0.34%, and 0.14%.

This is the honest edge over a Krystal-style single-position workflow: the basket smooths position-specific outcomes and packages several independently managed fee engines into one redeemable token. It did not beat the best single LP on absolute return in this one market regime.

## How overfitting was constrained

The study did not optimize hundreds of custom thresholds or portfolio weights.

- The management search used only four range widths, two persistence windows, two cooldowns, and two compound cadences.
- Policies were ranked under a 75% fee haircut.
- Every policy was evaluated on three separate ten-day folds.
- A candidate needed at least 90% full-period uptime, at least 85% uptime in every fold, no more than two re-bands in a fold, and no more than five over the month.
- Basket weights were fixed from liquidity capacity, correlation, and role in the portfolio before evaluating the combined path.
- The 50% and 75% fee cases reuse the exact same assets, weights, ranges, and cadence.

The evidence is still one month on a new chain. It is a robust canary design, not proof across a full market cycle.

## Sleeve policy

### WETH/USDG — 45%

- Range: ±10% geometric
- Edge persistence: 12 hours
- Re-band cooldown: 72 hours
- Compound check: weekly
- Role: deepest fee engine and primary return sleeve

The 24-hour and 72-hour cooldowns produced the same observed full-month path. The pilot uses 72 hours because it limits unseen churn without sacrificing the captured result.

### NVDA/USDG — 20%

- Range: ±10%
- Edge persistence: four hours, but only while the underlying reference is fresh
- Re-band cooldown: 24 hours
- Compound check: weekly
- Role: high-volume equity fee sleeve

### QQQ/USDG — 15%

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
- Minimum 10% directly withdrawable USDG reserve
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

## Capacity and launch gates

- Initial seed: $10,000–$25,000.
- Hard initial basket cap: $25,000 because AAPL is the limiting pool.
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
```

Primary outputs:

- `research/nonstable_lp_results/recommended_nonstable_basket.json`
- `research/nonstable_lp_results/portfolio_fold_results.csv`
- `research/nonstable_lp_results/robust_policies.json`
- `research/nonstable_lp_results/asset_daily_return_correlations.csv`
- `research/nonstable_lp_results/portfolio_value_series.csv`

## Sources

- GeckoTerminal hourly Robinhood Chain pool OHLCV and current pool metadata.
- RangeScout Robinhood Chain pool methodology and subsidy warning: https://api.rangescout.app/robinhood-chain-liquidity-pools/
- Krystal auto-rebalance documentation: https://docs.krystal.app/products/liquidity-management/lp-transactions/auto-rebalance
- Krystal compound documentation: https://docs.krystal.app/products/liquidity-management/lp-transactions/compound
- Uniswap concentrated-liquidity documentation: https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/concentrated-liquidity
- Robinhood canonical stock-token contracts: https://docs.robinhood.com/chain/contracts/
- Robinhood stock-token price-feed and trading-window documentation: https://docs.robinhood.com/chain/stock-tokens/
