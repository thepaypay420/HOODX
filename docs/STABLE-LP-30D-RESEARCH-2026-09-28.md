# HOODX stable LP basket: 30-day research and pilot design

Study cut: 2026-09-28. The USDe pool has 30 days of hourly history. The two U pools have only 18–20 days because they launched during the study window.

Status: **WAIT**. This is a protocol-controlled pilot design, not a production launch approval.

## Decision

The stablecoin thesis is sound, but Robinhood Chain does not yet have enough independent, mature stablecoin liquidity to launch a diversified LP index responsibly.

The best current venue is **U/USDG on PancakeSwap v3 at 0.01%**. It has about $5.94 million TVL, $35.51 million of observed volume over 20.2 days, and 99.18% of hourly closes stayed within 50 basis points of its observed median peg. It is still too new to treat that behavior as a full-month result.

The best launch shape after the gates below are satisfied is:

- 40% U/USDG, PancakeSwap v3, 0.01%
- 30% USDe/USDG, Uniswap v4, 0.01%
- 30% USDG reserve outside LP positions

This is deliberately only two LP sleeves. Adding the second U/USDG venue would make the card look more diversified without adding issuer diversification. The reserve gives exits and recovery a path that does not require a swap or an LP unwind.

## What the month says about returns

The available stable pools are low-fee pools. Their full-pool, pro-rata gross fee turnover was modest:

- U/USDG Pancake v3: 0.0598% over 20.2 observed days, about 1.08% annualized before loss, costs, incentives, or fee competition.
- U/USDG Uniswap v4: 0.0837% over 18.4 observed days, about 1.66% annualized on the same simple basis.
- USDe/USDG Uniswap v4: 0.0604% over 30 days, about 0.73% annualized.
- USDG/syrupUSDG Uniswap v4: about $2.93 million TVL but only roughly $105 of current 24-hour volume when captured. It is parked capital, not a useful fee sleeve.

Normalizing the two proposed LP sleeves to a 30-day month, the 40/30/30 basket's gross fee estimate is only **0.0536% of basket capital** before impermanent loss and operations. A 50% fee haircut reduces that to 0.0268%; a 75% haircut reduces it to 0.0134%.

The concentrated-liquidity reconstruction for U/USDG tested 405 policies across five half-ranges, three persistence windows, three cooldowns, three compound cadences, and three fee cases. The robust severe-fee result used a ±3% range, stayed active for 100% of the observed 485 hours, made no re-bands, and did not compound. It returned -0.269% while its passive starting-token mix returned -0.251%. Modeled LP excess was therefore **-0.0185%**, even though the range never went inactive.

That is the key result: current stable-pool fees are too small to justify aggressive re-banding or frequent compounding. The management system should protect capital and wait for material fees, not manufacture activity.

## Pool screen

### U/USDG — PancakeSwap v3, 0.01%

- TVL captured: $5.94 million
- Observed history: 20.2 days
- Observed volume: $35.51 million
- Median U price: $0.999624
- 99th-percentile close deviation: 43.6 basis points
- Hourly closes within 50 basis points: 99.18%
- Status: **best v3 pilot candidate, but history is incomplete**

Pancake v3 is preferred for the first sleeve because HOODX can independently verify the v3 pool contract and active liquidity. It still needs its own position-manager adapter, fork lifecycle, recovery, and accounting tests.

### USDe/USDG — Uniswap v4, 0.01%

- TVL captured: $1.01 million
- Observed history: 30 days
- Observed volume: $6.12 million
- Median USDe price: $0.999872
- 99th-percentile close deviation: 40.6 basis points
- Hourly closes within 50 basis points: 99.31%
- Status: **issuer-diversifying sleeve after v4 hook and adapter review**

USDe is not a conventional cash-backed stablecoin. Ethena describes peg support through delta-hedged backing and derivatives positions. That adds custody, exchange, funding, and hedge-execution risks that a stable LP card must state plainly.

### U/USDG — Uniswap v4, 0.008%

- TVL captured: $3.04 million
- Observed history: 18.4 days
- Observed volume: $31.82 million
- 99th-percentile close deviation: 51.6 basis points
- Hourly closes within 50 basis points: 98.64%
- Status: **venue alternate, not a third diversified sleeve**

It has stronger recent volume turnover than the Pancake venue, but it repeats the same U and USDG issuer exposure. It also adds a v4 pool-manager and hook-review path. Use it as a failover candidate after its exact configuration is verified, not as fake diversification.

### Pools rejected from the pilot

- USDG/syrupUSDG: large TVL with negligible trading activity.
- USDC/USDG and USDT/USDG: available Robinhood Chain pools were only a few thousand dollars deep.
- UUSD/USDG: weaker activity and an issuer that did not meet this safer-major screen.
- USDe/USDB: apparent large TVL but effectively no observed trading, plus a questionable secondary peg.

## Management policy

### Initial range

Use a **±3% geometric half-range** around a manipulation-resistant reference, rounded to valid pool ticks. This is wider than a classic 0.99–1.01 stable range because the observed data contained short deviations and bad wicks. The extra width sacrifices headline APR for continuous liquidity and a safer first deployment.

The center is not blindly $1.00. Use the median of independent USD references for both tokens and require venue spot, a 30-minute TWAP, and external issuer/token pricing to agree within 25 basis points before minting or moving a position.

### Re-band

Do not re-band on a clock. Evaluate at least hourly, then move only when all gates pass:

1. Price remains in the outer 15% of the range for 24 consecutive hours.
2. The prior re-band was at least seven days ago.
3. Both tokens remain within the normal peg band against independent USD references.
4. The proposed center differs from the current center by at least 50 basis points.
5. Expected 30-day incremental fees exceed swap, liquidity-removal, mint, gas, and slippage costs by at least 4×.
6. A fork simulation verifies balances, ticks, minima, deadline, hook/configuration, and direct recovery.

If one token is genuinely depegging, **pause instead of chasing it**. Re-centering around a failing peg converts the healthy side into the impaired asset.

### Compound

Check weekly, but compound only when the total uncollected fees exceed all execution costs by at least 4× and are at least 0.05% of the sleeve. With the observed fee levels, monthly or less frequent compounding is more realistic. The best severe-fee U/USDG policy did not compound once.

Fees should refill the 30% USDG reserve before increasing LP exposure.

### Depeg state machine

- Normal: both tokens within 50 basis points of independent USD references.
- Watch: either token outside 50 basis points for 30 minutes; block new deposits into that sleeve.
- Pause: outside 100 basis points for one hour or reference disagreement over 50 basis points; stop compounding and re-banding.
- Recovery: outside 200 basis points, issuer redemption is impaired, or venue prices diverge materially; use the pretested direct-withdrawal path. Do not swap the entire sleeve through a thin or manipulated route.

## Pilot limits

- Seed: $10,000–$25,000 total.
- Maximum per sleeve: 0.5% of current active liquidity and 1% of pool TVL, whichever is lower.
- Reserve: 30% USDG held outside LP positions.
- No incentives in the base return case.
- No permissionless user-created LP indexes until the protocol pilot completes a full deposit, fee collection, compound, re-band, partial withdrawal, full withdrawal, depeg pause, failed-call retry, and emergency recovery lifecycle on a fork and canary.

## Launch gates

1. Collect 30 complete post-subsidy days for both U pools. Their current 18–20 day histories are insufficient.
2. Verify exact v4 pool configuration and prove there is no unreviewed hook behavior.
3. Implement separate, allowlisted adapters for Pancake v3 and Uniswap v4 position managers.
4. Prove independent NAV from underlying token balances, accrued fees, and range state.
5. Prove direct pro-rata withdrawal when one position manager, router, token, oracle, or pool is unavailable.
6. Add issuer and jurisdiction review. United Stables publishes attestations, but its terms say reserve composition may change, peg value is not guaranteed, and direct redemption depends on approved onboarding. Its public attestation page also describes geographic and licensing restrictions.
7. Re-run the model after the Robinhood Wallet gas-waiver period using only post-waiver volume.

Until those gates pass, this is a researched pilot candidate—not a stable-yield product ready for users.

## Method and reproducibility

The pool screen uses GeckoTerminal hourly OHLCV and current pool metadata captured on 2026-09-28. Newly created pools retain only their real lifespan; the model does not backfill pre-creation hours. The v3 simulation uses current onchain active liquidity as the fee-share denominator. Historical tick-level liquidity and exact fee growth were unavailable, so fee haircuts of 50% and 75% expose that uncertainty.

Reproduce with:

```text
python research/stable_lp_month_backtest.py
```

Primary outputs:

- `research/stable_lp_month_results/stable_pool_screen.csv`
- `research/stable_lp_month_results/u_usdg_pancake_strategy_grid.csv`
- `research/stable_lp_month_results/stable_pilot_decision.json`

## Sources

- GeckoTerminal Robinhood Chain pool pages and API for OHLCV, current TVL, and volume.
- Uniswap developer documentation on concentrated liquidity and out-of-range behavior: https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/concentrated-liquidity
- Krystal auto-rebalance documentation for trigger persistence, minimum fees, gas ceilings, and slippage controls: https://docs.krystal.app/products/liquidity-management/lp-transactions/auto-rebalance
- Ethena documentation for USDe backing and peg design: https://docs.ethena.fi/
- United Stables attestation page: https://www.u.tech/transparency/audit-report/
- United Stables terms: https://www.u.tech/terms/
