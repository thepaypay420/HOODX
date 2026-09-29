# HOODX degen LP vault design

**Research snapshot:** 28 September 2026
**Status:** design candidate; no contracts deployed and no user deposits enabled

> **Launch Hunter update (29 September):** the larger direct onchain cohort replay supersedes the preliminary launch template below. Launch Hunter is now **shadow mode only**. See `LAUNCH-HUNTER-DEEP-RESEARCH-2026-09-29.md` for the tested funnel, negative held-out evidence, staged 1% scout design and promotion requirements.

## Decision

HOODX should build two different products. Combining them would hide materially different risks.

1. **Degen Yield** is a shared, protocol-controlled basket of established Robinhood Chain projects. It earns high LP fees with wide ranges and deliberately slow management.
2. **Launch Hunter** is a protocol-only active-launch incubator. It observes many launches, funds very few, limits each loss, and preserves a small runner when a launch proves itself.

The existing **Liquidity Prime** design is now locked in the product catalog as a pilot: 50% Uniswap WETH/USDG, 40% Up WETH/USDG and 10% liquid USDG. Public deposits remain gated on the Up adapter and canary.

## Degen Yield: recommended first formula

| Sleeve | Weight | $200 pilot | Default range | Why it earned a place |
|---|---:|---:|---:|---|
| CASHCAT/WETH Uniswap v3 0.30% | 30% | $60 | ±25% | Best combination of depth, durable volume and fee tier in the established screen |
| PONS/WETH Uniswap v3 0.30% | 25% | $50 | ±35% | Largest established token and deepest direct v3 route in the basket |
| AI/WETH Uniswap v3 1.00% | 20% | $40 | ±50% | Highest modeled durable fee density, capped because volatility is materially higher |
| WETH/USDG Uniswap v3 0.01% | 15% | $30 | ±30% | Exit liquidity and lower-volatility fee rail |
| WETH reserve | 10% | $20 | none | Recovery, maintenance and withdrawal buffer |

The three degen sleeves produced a **60.0% weighted modeled durable fee APR contribution** before the core sleeve, impermanent loss and management costs. The headline volume-derived contribution was 451%, which is not credible as an underwriting assumption. The durable figure applies a 75% base fee haircut, an active-day discount and a recent-volume persistence cap. It is still an estimate, not a promised return.

### Measured 30-day screen

| Pool | Current TVL | 30-day volume | Headline fee APR | Durable screen APR | 30-day price drawdown |
|---|---:|---:|---:|---:|---:|
| AI/WETH 1.00% | $2.95m | $216.3m | 892.3% | 89.2% | -35.7% |
| CASHCAT/WETH 0.30% | $2.41m | $336.4m | 508.8% | 90.6% | -47.3% |
| PONS/WETH 0.30% | $4.56m | $600.2m | 480.2% | 59.7% | -41.6% |
| CASHCAT/WETH 1.00% | $4.65m | $92.2m | 241.1% | 34.7% | -47.1% |
| MEME/WETH | $146.9k | $27.1m | 673.5% | 58.0% | -79.9% |
| INDEX/WETH | $811.2k | $70.4m | 316.8% | 23.9% | -67.0% |
| DELTA/WETH | $1.40m | $88.0m | 229.8% | 24.6% | -71.7% |
| WALLET/WETH 1.00% | $3.55m | $59.1m | 202.6% | 10.1% | -76.9% |

MEME, INDEX, DELTA and WALLET were rejected from version one. Their recent drawdowns or weaker durable fee edge add risk without improving the basket enough.

### Management policy

- Check conditions every 15 minutes; checking never moves funds.
- Require price to remain at an outer edge for six continuous hours.
- Use one shared maintenance transaction when possible. Do not compound by schedule.
- Allow at most two portfolio maintenance windows per month at $200.
- Require projected 30-day net fees to cover the full action cost by at least 6×.
- Never re-center downward while flow is sell-dominated. A downside breach moves that sleeve to WETH instead of chasing the token.
- Cap any one token pair at 30%, any 1% fee pool at 20%, and the total non-core exposure at 75%.
- Keep direct sleeve redemption and WETH recovery independent of the automation service.

## Launch Hunter: winner-capture template

The edge over a single-position manager is portfolio selection and lifecycle management. A concentrated LP naturally sells a token as it rises, so a symmetric LP alone does not retain the full winner. Launch Hunter adds a strictly capped runner sleeve.

### Allocation

| Bucket | Weight | Limits |
|---|---:|---|
| Probe LPs | 40% | Four positions maximum; 10% each |
| Promoted LPs | 25% | Two positions maximum; 15% per project |
| Winner runners | 10% | Two tokens maximum; 5% each |
| WETH reserve | 25% | Always liquid; never placed in a launch pool |

At a $200 canary this is $20 per probe, up to $30 per promoted project, $10 per runner and $50 held in WETH.

### Admission funnel

**Observe — no capital for the first two hours**

- Pool TVL must exceed $50,000 and remain above it.
- At least 150 unique buyers and 150 unique sellers in the observed window.
- Buy/sell transaction balance must remain at or above 0.65.
- Volume/TVL must be between 1× and 20×; extreme turnover is treated as manipulation evidence, not automatic quality.
- Pool, token and route identities must be exact; symbols and names are never trusted.

**Probe — maximum 10%**

- Two independent fork buy-and-sell simulations pass at different sizes.
- Transfer tax is no more than 2%; received amounts reconcile.
- No arbitrary mint, blacklist, transfer pause, confiscation or owner-controlled sell restriction.
- The deployer holds no more than 5%; top ten non-pool wallets hold no more than 35% unless identified and justified.
- The LP/hook path has bounded callbacks, gas, slippage and deadline; one reverting token cannot block another sleeve or direct redemption.

**Promote — after 12 hours**

- TVL is flat or rising from probe entry.
- Unique trader breadth grows; the same small wallet cluster does not dominate volume.
- The pool still passes two-way sell simulation.
- A 30-minute TWAP and spot agree within 5%.

**Graduate or exit — at seven days**

- Graduate only after seven active days and a second full security review.
- Exit on contract-control change, sell failure, 20% TVL loss over one hour, or sustained downside breach with sell-dominated flow.
- Failed automation never retries without a fresh quote. Maximum three attempts over 30 minutes, then park the sleeve and alert the curator.

### Re-band and winner rules

- Start probes at ±40%. After 24 hours, use `clamp(±25%, ±60%, 2 × median daily absolute move)`.
- An upside re-band requires 15 minutes beyond the upper edge, rising TVL, and buy/sell balance of at least 0.80.
- A downside breach never re-bands lower automatically. It exits to WETH after 15 minutes when sell dominance or TVL loss confirms the move.
- Limit each position to four re-bands per day and the entire vault to eight. Batch when multiple sleeves are eligible.
- At 2× the entry price, return the probe principal to WETH and retain at most 5% of vault value as a direct-token runner.
- Trail a runner 30% below its high-water mark. A runner can grow to 10% through appreciation but receives no new capital above 5%.
- Compound fees only during a required re-band, promotion, exit or user-funded flow.

### Current snapshot examples

ROBINPEPE/WETH, PEVL/WETH and HOODIE/WETH scored well on current depth, turnover and two-sided trader breadth. They are **examples for exercising the funnel, not approved assets**. The snapshot cannot prove sellability, ownership safety, holder concentration, hook behavior or sustainable volume.

## Why this is stronger than copying Krystal

Krystal exposes per-position auto-rebalance, auto-exit and agent-directed farm selection. HOODX can bundle multiple LPs behind one recoverable index share, apply the same public rules to every holder, preserve a reserve, and graduate winners across lifecycle buckets. The programmatic engine should decide whether an action is allowed. An AI can rank candidates and explain evidence, but it should not be able to bypass pool, token, budget, range, slippage, cooldown or withdrawal rules.

## Required build sequence

1. Finish and fork-test the concentrated-liquidity sleeve adapter, including direct recovery.
2. Launch Liquidity Prime as the protocol canary.
3. Add Degen Yield behind the same adapter with exact-address pool admission and a $200 hard cap.
4. Run Launch Hunter in shadow mode for at least 30 launches. Record every admission, rejection, simulated re-band and hypothetical result.
5. Only then fund a protocol-controlled Launch Hunter canary. Permissionless user-created LP indexes come after the shared-vault isolation and griefing tests pass.

## Evidence limits

- GeckoTerminal hourly OHLCV omits quiet hours; the model fills price forward and records zero volume.
- Historical active liquidity and fee growth were unavailable. Fee APR is based on pool volume, fee tier and current TVL, then severely discounted.
- Launch screens use current snapshots and cannot establish safety. All launch assets remain unverified until on-chain and fork checks pass.
- Total return cannot be inferred from fee APR. Impermanent loss, token drawdown, range inactivity, MEV and execution costs can overwhelm fees.
