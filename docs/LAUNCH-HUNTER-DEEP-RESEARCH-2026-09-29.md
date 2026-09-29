# HOODX Launch Hunter: multi-cohort onchain research

**Research snapshot:** 29 September 2026

**Decision:** build the scanner and shadow portfolio; do not open a capital-bearing public vault

## Breakthrough finding

Launch Hunter should not be a permanent LP basket or an early-launch chase. The onchain evidence separates the product into two different engines:

1. **Fee-bearing LP engine:** only pools where HOODX can prove that fees accrue to its position. Current launch inventory did not establish a positive LP edge.
2. **Delayed survivor engine:** wait 24 hours, select very few continuing launches, cap each at 0.5% of NAV, admit only one token per creator cluster, and recover principal quickly. This produced a promising convex shadow result, but only four trades passed the frozen rule.

The portfolio constraint is the useful discovery. A single-launch product concentrates creator and gap risk. A basket can suppress that risk by clustering related launches, funding only the strongest continuation in each cluster, and leaving at least 97.5% in WETH.

## Research denominator

The private archive-RPC study enumerated every ETH/WETH Uniswap v4 pool initialized during four independent six-hour windows on 13, 15, 17 and 20 September 2026.

- **6,339** launches formed the complete denominator.
- **113** passed the two-hour activity/manipulation gate: 1.78%.
- Median selected-pool price after the observation point finished at **0.34x, 0.60x, 0.61x and 0.34x** by cohort.
- Only **11 of 113** sustained a 2x move for at least one hour.
- Median five-minute signed markout among selected pools was mean-reverting, but the distribution was wide enough that a blanket LP policy remained unsafe.

The gate requires at least 40 swaps, 0.5 ETH volume, a 0.40 buy/sell count balance, activity in six of eight quarter-hours, top-ten trades at no more than 70% of volume, and repeated exact sizes at no more than 30%.

## Fee ownership changed the design

Market activity is not LP revenue. Of the 113 selected pools:

- **73 were PONS v2 graduates.** Their v4 pool fee is zero; the PONS hook collects and routes its own fee. An outside LP must not treat that tax as position yield.
- **22 were hookless with an unverified launch origin.** They remain ineligible until factory provenance and token behavior are pinned.
- **18 used other hooks.** Unknown hook code fails closed.
- Across the full 6,339-pool denominator, **579 used the canonical Doppler hook**, but only five passed a relaxed fee-bearing LP activity gate and only two passed the stricter market gate.

The five canonical Doppler candidates were replayed with exact emitted liquidity, observed swap fees, a 25% fee-credit haircut, $0.10 per action, and a $20 position.

- A WETH-only pullback range had a best median of **-1.0%** and no positive outcomes.
- A short centered volatility harvest had a best median of approximately **-1.0%**, a **-6.9% mean**, and one loss below -31%.
- Fee income did not cover inventory loss and action cost across the sample.

This rejects a public claim that Launch Hunter can earn launch yield merely by placing active ranges around new pools.

## Directional policy tests

Full-size breakout entries also failed. Across 243 staged-entry combinations, no policy remained positive in the held-out split and every calendar cohort. Rare winners existed, but ordinary 20-30% stops could gap to substantially larger realized losses.

A delayed cross-sectional basket performed better:

- decision time: 24 hours after launch;
- known PONS v2 family only for this directional study;
- current price at least 1.25x the two-hour reference;
- at least 20 ETH of volume, 48 swaps and 12 active 15-minute bars in the prior six hours;
- rank by recent six-hour volume;
- one token per exact creator cluster, at most five tokens;
- 0.5% of vault NAV per token;
- 20% intended stop, recover principal at 1.5x, 40% trailing exit, 12-hour maximum hold.

The parameter neighborhood from 1.25x to 2x and 12-96 hours produced the same four qualifying selections, so the result was not dependent on one exact threshold. Vault-level outcomes were:

- **-0.133%, -0.123%, -0.114%, +2.009%** across the four cohorts;
- **+0.410% mean**, **-0.118% median**;
- one winner produced the entire positive mean.

This is breakthrough progress in risk construction, not proof of return. Four selections cannot support an APY, a public deposit product, or a claim of positive expected value.

## Launch Hunter Shadow v2

### Capital structure

- WETH reserve: **97.5% minimum**.
- Survivor probes: **0.5% each**, maximum five.
- Per creator/funding cluster: **one active token**.
- Unknown hook, unknown factory, missing sell simulation, missing history, or RPC disagreement: **0%**.
- PONS graduates: directional shadow only; never count hook tax as LP yield.
- Canonical Doppler: LP shadow only until a larger fee-bearing sample is positive after costs.

### Admission and management

1. Pin factory, hook, pool, token runtime hash and fee recipient semantics.
2. Observe for two hours and run the market-quality gate.
3. Continuously simulate two sell sizes and detect mutable tax, blacklist, pause, mint, confiscation and upgrade powers.
4. Wait until hour 24. Require continued price, volume and activity; rank candidates cross-sectionally.
5. Cluster by creator and funding relationship. Admit only the highest-scoring token in a cluster.
6. Shadow a 0.5% probe. Model gaps at the observed execution price rather than the stop trigger.
7. Recover original capital at 1.5x after entry. Trail the remainder by 40% and force exit after 12 hours.
8. A failed sell quarantines only that asset. Direct redemption and unrelated vault operations must remain available.

## What HOODX can do better than a single-LP manager

- scan the full launch denominator rather than a promoted feed;
- distinguish trading tax from collectible LP fees;
- reject unknown hook and launch provenance;
- cap correlated creator exposure across many launches;
- hold WETH while candidates fail instead of continuously rebanding a dying pool;
- publish every rejection, promotion, simulated exit and shadow result;
- later combine independently proven LP and survivor sleeves without allowing either to block withdrawal.

## Promotion gates

No capital should move until all of the following are true:

- at least 30 calendar days and 500 fully reconstructed launches;
- at least 30 security-qualified survivor candidates and 30 fee-bearing LP candidates;
- creator clustering expanded from exact sender to common funder and deployment graph;
- a frozen policy evaluated on later untouched cohorts;
- positive mean and median after impact, hook tax, gas and failed-exit modeling;
- bootstrap 95% lower confidence bound above zero for the vault-level return;
- maximum modeled vault drawdown below 5% and maximum launch sleeve below 2.5%;
- local-fork tests for buy, sell, gap, hook failure, route failure, quarantine and direct redemption;
- a protocol-funded $200 canary with no public deposits.

## Evidence and limitations

Reproducible code lives in:

- `research/launch_hunter_multicohort_study.py`
- `research/launch_hunter_longitudinal_study.py`
- `research/launch_hunter_doppler_lp_study.py`
- `research/launch_hunter_survivor_study.py`

Derived evidence is under `research/launch_hunter_multicohort_results/`. Raw archive responses and the private RPC credential are excluded from version control. The study is read-only and sent no transaction.

The sample can reject unsafe designs, but it cannot prove future sellability, token safety, or investable alpha. Fifteen-minute bars understate intra-bar gaps. Exact creator addresses are only the first clustering layer; common funders and coordinated wallets remain unmodeled. PONS directional results do not imply external LP revenue. The canonical Doppler LP sample contains only five active candidates.

Primary references:

- Uniswap Liquidity Launchpad deployments and fee-recipient design: https://developers.uniswap.org/docs/liquidity/liquidity-launchpad/deployments
- Canonical Doppler deployments: https://github.com/whetstoneresearch/doppler/blob/main/Deployments.md
- PONS v2 fee and locked-liquidity design: https://github.com/ponsdotdev/pons-labs/blob/main/README.md
- Uniswap v4 hook and dynamic-fee architecture: https://app.uniswap.org/whitepaper-v4.pdf
- AMM loss-versus-rebalancing research: https://arxiv.org/abs/2208.06046
- FLAIR research on fee return, flow toxicity and LP competition: https://arxiv.org/abs/2306.09421
