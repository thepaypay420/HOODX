# HOODX stable-only yield router

Research cut: 2026-09-28. Rates are variable snapshots, not promised returns.

## Answer

The highest credible stable-only rate currently visible to an eligible Robinhood user is **an estimated 7% APY** through Robinhood Earn's USDG deposit into the Steakhouse USDG Morpho vault. That is a reward-inclusive estimate. The same vault currently shows **3.94% instant net APY and 3.79% 30-day APY** on Morpho. Robinhood explains that its displayed APY combines the vault rate with additional variable Morpho rewards.

For a HOODX index, the best responsible starting basket is:

- 60% Steakhouse USDG through Morpho
- 30% Spark Savings spUSDG
- 10% liquid USDG reserve

That mix has an indicative **5.25% reward-inclusive APY** if the HOODX contract is eligible for, can claim, and can compound the same Morpho rewards. Its current organic 30-day estimate is about **3.32% APY** before HOODX fees. Until reward claiming is proven from the actual index contract, the product must display 3.32% as the verified rate and show the extra 1.93 points only as unverified incentives.

The pure maximum-rate allocation would place everything in the 7% offer. That is not a useful basket: it has one yield source, one curator, one vault-liquidity exit, and no direct reserve. The 60/30/10 construction gives up headline yield for a second savings rail and immediate liquidity.

## Why tight-band LP is not the base yield

The U/USDG Pancake v3 pool was tested over its full 485-hour observed history using ten half-ranges from 5 to 300 basis points, multiple persistence windows, 1–7 day cooldowns, raw fees and a 75% fee stress, and monthly fee reinvestment.

At the actual observed fee volume, every tested width lagged passive ownership of its starting tokens. The best raw-fee outcomes by width were:

- ±25 bps: -1.92% annualized excess, 91.8% in range, one re-band
- ±50 bps: -1.06% annualized excess, 96.9% in range, no re-bands
- ±300 bps: -0.17% annualized excess, 100% in range, no re-bands

Tighter ranges created more fee density but lost too much uptime and/or value when the peg moved. Re-banding faster did not repair the economics; it added turnover and conversion cost.

The LP sleeve should therefore be **0% now**. It is a tactical option, not a required ingredient.

## The activation rule

Reserve at most 10% of the basket for U/USDG concentrated liquidity, funded from the Morpho sleeve, and activate it only if a fresh 30-day model projects at least **12% annualized excess yield after** range loss, swaps, re-band costs, gas, fee competition, and a 75% fee haircut.

The candidate policy is:

- ±25 basis-point half-range around a manipulation-resistant reference
- 12 hours of persistent edge pressure before any re-band
- seven-day minimum cooldown
- monthly fee reinvestment, or later only when fees cover all costs by at least 4×
- pause on reference disagreement or depeg; never chase a failing peg

The current pool needs about **6.75× its observed fee volume** to interpolate through the 12% excess-yield hurdle; the first discrete tested point that passed was 8×. A ±50 bps range did not clear 12% even at 10× observed volume. This makes the on/off decision objective and stops the curator from manufacturing activity to make the product look managed.

## What makes the basket worth holding

1. **One stable token, multiple yield rails.** Users do not have to monitor Morpho allocations, Spark rates, claimable rewards, or reserve liquidity.
2. **Organic yield and incentives are separated.** The card shows verified 30-day organic APY, current rewards, and the combined estimate as three distinct numbers.
3. **Yield is routed, not chased.** New deposits and matured rewards fill the most underweight approved sleeve first. Existing positions are sold only when a hard allocation, risk, or liquidity threshold is crossed.
4. **Withdrawals retain a liquid path.** Ten percent USDG remains outside yield contracts. The index also needs direct pro-rata redemption so a Morpho or Spark outage cannot freeze all exits.
5. **The LP edge is conditional.** Tight liquidity turns on only when the measured opportunity beats lending by a large margin. At today's volume it remains off.

## Management cadence

- Read rates, available liquidity, reward status, and peg references hourly.
- Rebalance with deposits, withdrawals, and earned yield continuously when that requires no sale.
- Allow a capital-moving rebalance no more than weekly, after a 24-hour persistent allocation breach and a fresh simulation.
- Compound Spark and Morpho only when the marginal gain exceeds total execution costs by at least 4×.
- Keep the 10% reserve intact before increasing any risk sleeve.
- Treat incentive expiry, claim failure, oracle staleness, liquidity below the withdrawal buffer, or a 50 bp peg deviation as a block on new deposits into the affected sleeve.

## Required proof before building or advertising 5.25%

1. Fork-test deposit, share accounting, reward accrual, claim, compound, partial withdrawal, full withdrawal, and unavailable-liquidity behavior for the exact Steakhouse and Spark contracts.
2. Verify whether Morpho rewards accrue to and are claimable by the HOODX vault contract. If not, remove them from the product APY.
3. Verify that the existing HOODX withdrawal/recovery design can redeem yield-bearing shares directly without a router or fresh price.
4. Add hard protocol caps, independent USD references, stale-rate handling, and a reserve floor.
5. Run a protocol-funded canary before accepting public deposits. No live transaction is authorized by this report.

## Reproduction

Run:

```text
python research/stable_yield_router_study.py
```

Outputs:

- `research/stable_yield_router_results/tight_band_grid.csv`
- `research/stable_yield_router_results/lp_activation_curve.csv`
- `research/stable_yield_router_results/yield_router_scenarios.csv`
- `research/stable_yield_router_results/stable_yield_decision.json`

## Sources

- Robinhood Earn product page: https://robinhood.com/us/en/crypto/earn/
- Robinhood Earn support and disclosure: https://robinhood.com/us/en/support/articles/crypto-earn/
- Steakhouse USDG vault: https://app.morpho.org/robinhood-chain/vault/0xBeEff033F34C046626B8D0A041844C5d1A5409dd/steakhouse-usdg
- Spark Savings data: https://data.spark.finance/savings
- Spark Savings documentation: https://docs.spark.finance/products/spark-savings
- U/USDG pool data captured from GeckoTerminal on 2026-09-28.

