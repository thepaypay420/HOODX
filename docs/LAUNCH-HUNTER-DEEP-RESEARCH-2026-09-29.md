# HOODX Launch Hunter: historical cohort research

**Research snapshot:** 29 September 2026
**Decision:** build the scanner and shadow portfolio; do not open a capital-bearing public vault yet

## The finding

Launch Hunter can become a strong HOODX product, but the edge is not early entry or the highest displayed APR. The launch stream is dominated by pools that are dead, mechanically churned, or too incomplete to underwrite. HOODX's defensible edge is a **fail-closed admission funnel, tiny staged exposure, and automatic principal recovery from the rare winner**.

The direct onchain replay did not prove a positive, repeatable live-capital edge. A launch vault should therefore remain in shadow mode until a larger rolling sample passes the promotion gates below. Shipping capital first would turn users into the experiment.

## What was measured

The study enumerated every ETH/WETH Uniswap v4 pool initialized through Robinhood Chain's live PoolManager during a fixed six-hour historical cohort on 20 September 2026.

- 986 ETH/WETH launch pools formed the denominator, including pools never surfaced by discovery APIs.
- 181 had at least 40 swaps in their first two hours.
- 171 also traded at least 0.5 ETH.
- 143 also had a buy/sell count balance of at least 0.40.
- Only 18 remained active in at least six of eight 15-minute windows.
- Seven-day histories were complete within the work budget for 11 of those 18. Incomplete histories failed closed.

This means **98.2% of the raw launch cohort failed the market-quality gate** before token security checks. Public “new pool” feeds were much shallower: the accessible feed covered only about 46 minutes during collection, so it would have hidden the failed-launch denominator and inflated apparent success.

## Replay result

The strategy grid tested 72 combinations:

- observation delays of 2, 4, 6 and 12 hours;
- symmetric LP widths of ±25%, ±40% and ±60%;
- downside exits at 15%, 25% and 35%;
- principal recovery with a retained runner versus LP-only management.

The replay charged $0.20 per management action, capped the strategy at 5% of emitted active liquidity, and credited only 50% of pro-rata fee flow. A deterministic pool-id split separated training and held-out pools.

No combination established a reliable positive edge. The strongest median training result was the two-hour, ±40%, 25% stop, runner policy: +8.4% median, but -10.2% mean. Its held-out mean was -12.6%. The least-negative held-out result was a four-hour, ±60%, 15% stop, runner policy at -2.8%, but its training mean was -13.7%. The held-out set contained only two complete pools, so every policy estimate remains **UNVERIFIED**, not launch evidence.

The runner mattered. LP-only variants frequently lost more than half because concentrated liquidity sells the winner during the rise and retains the failing token during the fall. Recovering principal at 2× materially reduced the right-tail giveback, but did not by itself create a positive cohort mean.

## Recommended formula: Launch Hunter Shadow

### Vault-level capital limits

| Sleeve | Target | $200 pilot equivalent |
|---|---:|---:|
| WETH reserve | 70% | $140 |
| Probe LP book | 20% | four slots, $10 each maximum |
| Graduated LP book | 5% | one slot, $10 maximum |
| Winner runners | 5% | two tokens, $5 each maximum |

For shadow mode these weights are calculated but no funds move. After validation, the first live canary should use protocol capital only and the same dollar limits.

### Admission sequence

1. **Canonical origin.** Accept only launches produced by an explicitly versioned factory and hook deployment. The first integrations should be official Doppler deployments and a separately reviewed PONS factory/hook pair. An unknown hook, direct PoolManager call, copied symbol, or unrecognized bytecode fails closed.
2. **Two hours of observation.** Require at least 40 swaps, 0.5 ETH volume, both directions with a 0.40 balance, and activity in six of eight quarter-hour windows. Volume is capped in scoring; extreme turnover creates a manipulation flag.
3. **Contract and route safety.** Pin token runtime hash, decimals, supply behavior, pool id, hook, fee logic and route. Run bounded buy and sell simulations at two sizes. Reject mutable tax, blacklist, arbitrary mint, transfer pause, upgrade, or confiscation powers unless the exact power is intentionally supported and surfaced.
4. **Four-hour survivorship check.** Price, active liquidity and two-sided flow must still exist. A missing or oversized history, RPC disagreement, unavailable sell quote, or unresolved metadata produces no entry.
5. **One-percent scout.** The first live position is 1% of vault value. It may graduate to 5% only after six hours of successful sellability checks and no security-state change. It never jumps directly to a full slot.

### Position management

- Start at ±60% around entry. Narrower launch ranges captured more fees in places but increased churn and adverse-selection exposure.
- Exit at 15% below weighted entry; do not re-center downward into sell-dominated flow.
- Re-center upward only after 90 minutes, continued two-sided flow and sufficient projected fees to cover the action by 8×.
- At 2×, remove enough value to recover original principal plus execution costs. Keep at most 2.5% of vault value as a direct-token runner.
- Sell the runner on a 30% drawdown from its high or at day seven. A failed swap leaves the token directly claimable and quarantines the route; it must not block unrelated withdrawals.
- Permit at most two active launch positions and four total scouts at once. Queue later candidates in WETH.
- Stop admitting positions if one-hour action cost exceeds 10% of realized fees, the RPC/security service is unavailable, or the complete-history budget is exhausted.

## The protocol edge

Krystal-style automation improves one LP position. Launch Hunter should improve the **portfolio decision**:

- observe every launch but fund almost none;
- prove canonical origin and sellability rather than trusting names or APR;
- diversify four tiny scouts instead of betting one launch;
- automatically turn LP inventory into recovered WETH plus a capped runner;
- publish every rejection, promotion, reband and exit as a visible vault action;
- retain direct redemption so automation or quote outages cannot trap users.

This can later become a launch-quality data product even before the vault holds capital. The public scanner, rejection reasons, survival curve and shadow P&L establish a track record without putting depositors at risk.

## Promotion requirements

Launch Hunter can move from shadow to protocol-funded canary only after all of the following hold:

- at least 500 fully reconstructed launches across at least 30 calendar days;
- at least 50 candidates passing the market gate and 30 passing every security gate;
- a frozen policy tested on a later, untouched cohort;
- positive aggregate return after gas and modeled fees, positive median, and a bootstrap 95% confidence interval whose lower bound is above -5%;
- maximum simulated vault drawdown below 10% with 70% WETH reserve;
- successful local-fork entry, reband, principal recovery, stop, failed-swap quarantine and direct-redemption tests for every supported factory family;
- a protocol-funded $200 live canary with public actions and no user deposits.

Until then, the correct product state is **Shadow — observing launches**, not an advertised APY.

## Evidence and limitations

The replay code and auditable outputs are in `research/launch_hunter_cohort_study.py` and `research/launch_hunter_results/`. Raw RPC responses are intentionally excluded from version control.

The replay reconstructs pool prices, direction, active liquidity and swaps. It does not prove token safety, offchain identity, future sellability, or transaction-sender diversity. Seven of 18 candidate histories exceeded the bounded public-RPC work path and were rejected. The current sample is enough to reject an unsafe launch claim; it is not enough to claim an investable edge.

Primary references:

- Uniswap Liquidity Launchpad overview and transparent price-discovery flow: https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/overview
- Canonical Doppler deployments, including Robinhood Chain: https://github.com/whetstoneresearch/doppler/blob/main/Deployments.md
- AMM loss-versus-rebalancing research: https://arxiv.org/abs/2208.06046
- FLAIR research on fee return, flow toxicity and LP competition: https://arxiv.org/abs/2306.09421
