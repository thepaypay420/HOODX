# HOODX LP basket: 30-day range and cadence study

Study window: 2026-08-29 17:00 UTC through 2026-09-28 16:00 UTC.

Status: research result for a protocol-controlled canary. This is not a production launch approval.

## Decision

The strongest scalable first basket is a three-sleeve major-asset portfolio with a cash reserve:

- 55% WETH/USDG, Uniswap v3, 0.01% fee
- 20% NVDA/USDG, Uniswap v3, 0.05% fee
- 10% QQQ/USDG, Uniswap v3, 0.05% fee
- 15% USDG reserve

The model favors simple, wide-enough ranges and infrequent, event-driven management. A clock should check the positions; it should not automatically move them on every check.

With the exact same policy held fixed, the basket returned 4.56% during the observed month after cutting modeled fees by 50%. Its maximum drawdown was 2.40%. The passive starting token mix returned 3.39%, so modeled LP management added 1.13% in that case. Under a severe 75% fee haircut, the basket returned 3.41% with a 2.56% maximum drawdown, only 0.014% above the passive mix. This means the severe case was market beta, not meaningful LP alpha. These are modeled historical results, not expected returns.

Do not seed the canary until at least seven full days of post-subsidy volume have been collected. Robinhood Wallet's 90-day gas waiver ends on 2026-09-29, so the study month may contain fee volume that will not persist.

## What was tested

Nine Robinhood Chain Uniswap v3 pools were reconstructed from 720 hourly candles. The grid covered:

- symmetric half-ranges of 5%, 10%, 15%, 25%, and 40%
- edge persistence of 1, 4, and 12 hours
- re-band cooldowns of 12, 24, and 72 hours
- compounding intervals of 24, 72, and 168 hours
- observed fees, a 50% fee haircut, and a 75% fee haircut

That is 3,645 pool-policy simulations. Policies with less than 85% range uptime or more than six re-bands were excluded from the candidate ranking.

Every simulated position started with $10,000. A re-band paid 10 basis points of modeled swap loss plus $0.75. A compound paid 5 basis points of the collected fees plus $0.25 and could run only when accrued fees covered the fixed cost at least four times.

Hourly GeckoTerminal OHLCV supplied the observed price and volume path. Current onchain Uniswap v3 active liquidity supplied the fee-share denominator. Because historical tick-by-tick liquidity was not available from the bounded public RPC, current active liquidity is held constant. The fee haircuts are intended to expose that uncertainty rather than hide it.

## Pool findings

### WETH/USDG is the anchor

The 0.01% pool had roughly $19.9 million of liquidity and $15.17 billion of reported 30-day volume in the captured data. The unconstrained grid preferred a 5% half-range, but the proposed canary uses a 10% half-range because it gave 100% range uptime, required only one re-band, and remained strong in both fee-haircut cases.

Pilot rule: use a 10% geometric half-range, require 12 hours at the edge, enforce a 72-hour cooldown, and allow compounding no more often than every 72 hours.

### NVDA/USDG is the best liquid stock sleeve

The pool had roughly $5.2 million of liquidity and $712.7 million of reported 30-day volume. A 10% half-range stayed active for the full month with no re-band. The 50% haircut result was 3.79%; the 75% haircut result was 2.81%.

Pilot rule: use a 10% half-range, require 4 hours at the edge, enforce a 24-hour cooldown, and compound no more often than weekly.

### QQQ/USDG adds diversified equity exposure

The pool had roughly $1.33 million of liquidity and $96.0 million of reported 30-day volume. A 10% half-range stayed active for the full month with no re-band. The 50% haircut result was 1.74%; the 75% haircut result was 1.39%.

Pilot rule: use a 10% half-range, require 4 hours at the edge, enforce a 24-hour cooldown, and compound no more often than weekly.

### AAPL and SPY passed the model but failed the capacity preference

AAPL's best modeled result was 5.08% and SPY's was 0.38% under the 50% haircut, but their captured pools held only about $340,000 and $368,000. They should remain alternates until liquidity stays above $1 million for 30 days and a canary entry can stay below the capacity limits.

### GLD is blocked

Both inspected GLD pools showed a roughly 68% peak-to-trough discontinuity during the study. The data is not sufficient to distinguish an economic move from an indexer, oracle, or `uiMultiplier()` reconciliation problem. Robinhood stock tokens use an onchain multiplier for corporate actions, so the pool price, multiplier, and oracle must be reconciled before GLD can enter a basket. A familiar underlying does not make its onchain pool safe.

## Stablecoin basket finding

USDe/USDG is the only stable pair found with meaningful depth. The inspected Uniswap v4 0.01% pool held about $1 million. Over the month:

- median price was 0.99987 USDG per USDe
- 99.31% of hourly closes stayed within 50 basis points of parity
- 99.72% stayed within 100 basis points
- 30-day volume was about $6.12 million
- modeled full-pool pro-rata fee return for a $10,000 share was only 0.061% before loss and management costs

This is a useful stable sleeve candidate, but not yet a compelling active basket by itself. It is Uniswap v4, so it also requires a separately reviewed v4 adapter, hook policy, depeg mode, and recovery path. The current USDC/USDG and USDT/USDG pools did not have sufficient depth. The pure stable basket should wait for at least two independently liquid, reviewed pairs or a verified incentive that survives costs.

## Management structure

### Re-band only when all checks pass

1. The price is inside the outer 15% of the current range or outside it.
2. The condition persists for the sleeve's confirmation period.
3. The cooldown has elapsed.
4. Oracle, pool spot, and time-weighted price agree within the configured bound.
5. Projected incremental fees for the next seven days exceed total move costs by at least four times.
6. The replacement range passes a fresh simulation with minimum amounts, deadline, pool identity, and tick bounds pinned.

If any check fails, leave the position alone. A temporary out-of-range position is safer than a bad automated move.

### Compound economically, not constantly

- WETH sleeve: check hourly; compound at most every 72 hours.
- Stock sleeves: check during supported trading sessions; compound at most weekly.
- Skip any compound whose collected fees are below four times total execution cost.
- Send part of harvested fees to the USDG reserve whenever reserve weight is below 15%.

Daily compounding added activity without improving the robust policy. The weekly stock cadence captured nearly the same outcome with fewer operations.

### Capacity and concentration

- Start with a $10,000 to $25,000 total canary.
- Keep a sleeve below 0.5% of current active liquidity and below 1% of pool TVL.
- Do not add a pool below $1 million TVL to the scalable basket.
- Stop new deposits if seven-day volume/TVL falls below 0.10 or if executable exit slippage exceeds the approved limit.
- Keep the 15% reserve outside LP positions so maintenance and partial exits do not require a swap.

### Safe failure modes

- Oracle disagreement, stale prices, unsupported trading session, paused token, corporate action, abnormal multiplier, missing route, or failed simulation pauses management for that sleeve.
- A failed sleeve must not block fee collection, recovery, or direct redemption from healthy sleeves.
- Users must retain a direct pro-rata token recovery path that does not depend on the keeper, website, price service, or a swap.
- Repeated failed moves must not consume the cooldown or replace the last verified plan.

## Launch gates

The canary remains blocked until all of these are complete:

- seven days of post-2026-09-29 volume and spread data
- fork tests for mint, add, collect, re-band, exit, and partial recovery
- independent NAV using pool state plus stock-token `uiMultiplier()` and oracle checks
- capacity tests at proposed seed size and worst observed hourly move
- v3 adapter security review and permission tests
- failure tests for stale RPC, stale oracle, closed stock-token session, reverting asset, and unavailable route
- explicit legal eligibility review for stock-token exposure

## Reproducibility and limits

The executable model is `research/lp_month_backtest.py`. Summaries are in `research/lp_month_results/`. The raw grid records every tested combination.

The model does not reconstruct historical tick-level liquidity, MEV, exact gas, incentives, transfer restrictions, or every intra-hour path. Hourly candles can miss a brief boundary crossing. Current active liquidity is used as a constant fee-share proxy. The 50% and 75% haircuts reduce dependence on that proxy but cannot prove future performance. Production parameters must be refreshed from post-subsidy data and verified on a local fork.

## External references

- RangeScout Robinhood Chain pool screen: https://rangescout.app/robinhood-chain-liquidity-pools
- GeckoTerminal USDe/USDG pool: https://www.geckoterminal.com/robinhood/pools/0xa5f23cae4e5c3388c5a8a6b08a83f53e56df8f1a63757e606b362994b68a2361
- Uniswap concentrated-liquidity mechanics: https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/concentrated-liquidity
- Krystal auto-rebalance controls: https://docs.krystal.app/products/liquidity-management/lp-transactions/auto-rebalance
- Robinhood stock-token mechanics: https://docs.robinhood.com/chain/stock-tokens/
