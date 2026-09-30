# HUNTX multi-position LP edge — pre-registration (frozen before outcomes)

Frozen: 2026-09-30 (UTC), before any hold-period outcome in the panel below was
computed. This file is committed to the evidence set by SHA-256 in the final
report; later edits must be appended as a dated amendment, never rewritten.

## 0. Why the old replay cannot be used as an oracle

`research/huntx_edge_fee_validation.py` compared event-derived fee growth with
on-chain `StateView.getFeeGrowthGlobals` for the six Krystal pools, 42 pool-days.

* Uniswap V4 `Swap.amount0/1` are **caller-perspective** deltas: the *negative*
  amount is the input that pays the fee. Under this convention predicted/actual
  fee growth is 0.94–1.05 on 40 of 42 token-days (two VECTIS days are 1.21–1.60,
  large tick-crossing swaps).
* `research/krystal_multi_pool_lp_replay.py` charged fees on the *positive*
  (output) amount. Its ratios range 0.09–10.5: fees were credited in the wrong
  token. Its fixed 70% LP haircut is also wrong: the pools have no hook, a static
  LP fee, and a 0.1% (1000 pip) protocol fee each direction.
* Therefore all prior replay rankings (BOW +$5.79 etc.) are **void**. The new
  engine uses the validated convention and calibrates each pool-day to the
  on-chain fee-growth delta.

## 1. Universe and panel (no hindsight selection)

1. Registry: every PoolManager `Initialize` log from deployment (block 9,070) to
   block 76,069,815 (last block of 2026-09-29 UTC): 932,216 pools
   (`research/huntx_edge_registry.py`).
2. Activity screen: six 8,000-block windows per UTC day, 2026-08-18..2026-09-29,
   all Swap logs, pools quoted in USDG, WETH or native ETH
   (`research/huntx_edge_activity_screen.py`). Screen nominates only; it is
   not an outcome.
3. Panel pools: sampled quote-leg volume scaled by the sampling fraction gives an
   estimated day volume. A pool enters the complete scan if it has an estimated
   day volume ≥ $5,000 (USDG) / ≥ 1.5 ETH (WETH, ETH) on **any** sampled day and
   ≥ 3 sampled active days. Loose by design: dead and losing pools stay in.
4. Complete scan: every Swap log for panel pools, 2026-08-18..2026-09-29, with
   every chunk required (failure aborts).

## 2. Decision protocol

* Decision time: 00:00 UTC each day; decision block = first block with
  `timestamp ≥ 00:00`. Inputs = logs strictly before the decision block and
  archive state *at block − 1*.
* Decision days: 2026-08-25 .. 2026-09-26 (hold must complete by 2026-09-29 end).
* Development (sanity only, **no threshold is tuned on it**): 2026-08-25..09-07.
* Evaluation folds (untouched): F1 09-08..09-14, F2 09-15..09-21, F3 09-22..09-26.
  F3 overlaps the 2026-09-23..29 window already inspected by the prior agent for
  six pools: F3 is flagged partially contaminated.
* Prospective shadow: decisions at block 76,069,816 (2026-09-30 00:00 UTC) are
  frozen with a hash and scored later by the same script. Not scorable today.

## 3. Hard gates (all decision-time, all logged with reasons)

| Gate | Rule | Failure class |
|---|---|---|
| G1 age | pool initialized ≥ 3 days before decision | REJECT (new-launch stratum only) |
| G2 hooks | `hooks == 0x0` | hooked → UNVERIFIED (tracked, not investable) |
| G3 fee accounting | trailing-3d event fee growth / on-chain feeGrowthGlobal ∈ [0.85, 1.15] for each token with non-zero growth | UNVERIFIED |
| G4 executable | V4Quoter at decision block: entry swap and immediate reverse of the received amount both succeed at exact size | REJECT |
| G5 round-trip | quoted round-trip loss ≤ 2 × pool fee + 1.0% of swapped notional | REJECT |
| G6 flow persistence | ≥ 20 swaps on each of the 3 trailing days | REJECT |
| G7 concentration | largest single swap ≤ 25% of trailing-3d quote volume | REJECT |
| G8 token | not WETH/ETH/USDG base; exit token decimals readable | REJECT |

Token transfer tax / revert behaviour cannot be proven by eth_call; it is
**UNVERIFIED** in the panel and must be fork-tested for any pool a surviving
policy would select.

## 4. Position and cost model (identical for all hypotheses)

* Capital: $200 USDG pilot. Policies K ∈ {1, 2, 3} max concurrent positions,
  each position = $200 / K at entry. Held exactly **3 days** (primary, fixed a
  priori so fee income can amortize a 1–5% round-trip). 1-day hold reported as
  sensitivity only.
* Range: token pools [p/1.25, p·1.25] centred at the decision-block price;
  both-major pools [p/1.05, p·1.05]. Width sensitivity ±10%/±50% reported only.
* Entry: USDG → token via V4Quoter exact-input at decision block for the
  token share the range requires; mint at the decision price with the quoted
  token amount. Exit at block of hold end: position amounts at the exit slot0
  price + fees; token → USDG via V4Quoter exact-input **at the exit block**. A
  failed exit quote = failed exit, valued at 0 for the token leg.
* Fees: per swap in hold window, Δg = LP fee / active L (validated convention),
  credited if the swap path lies in range (log-price fraction), diluted by our
  own liquidity L/(L+L_ours), then scaled per pool-day so event Δg equals the
  on-chain feeGrowthGlobal delta.
* Gas: median observed USD cost of real PositionManager mint, decrease+collect,
  and swap transactions on chain in the panel window (receipts), × 4 transactions
  per round trip.
* Baselines: (a) do nothing (USDG, 0); (b) hold the exact post-entry token mix,
  exited with its own exit-block quote. Primary objective: **net pilot NAV
  change vs (a)**. Mechanism diagnostic: LP vs (b).

## 5. Hypotheses (frozen)

**H1 — persistent fee flow (established stratum).** Story: two-way organic
flow pays LPs more than inventory loss when fee income per unit of active
liquidity is persistent. Feature: trailing-3-day daily *LP-excess yield* of a
daily re-centred ±25% position (fees − inventory change vs hold, per $),
computed from pre-decision logs only. Eligible if G1–G8 pass, every one of the
3 trailing days has positive LP excess, and score = 3 × mean daily excess −
quoted round-trip cost % − gas % > 0. Rank by score × position size (dollar
surplus). Prediction: realized 3-day net vs USDG > 0 on average and rank
correlation(score, realized LP-vs-hold) > 0. Falsified if evaluation-fold mean
net ≤ 0 or the rank correlation ≤ 0.

**H2 — flow/liquidity mismatch.** Story: a temporary rise in fees per unit of
active liquidity pays new LPs before competing liquidity arrives. Feature:
trailing-24h position fee yield ≥ 2 × trailing-7d median daily yield, active
liquidity not up >50% over 3 days, G1–G8 pass. Rank by trailing-24h fee yield
minus round-trip cost. Prediction: next-3-day fee yield ≥ 50% of trailing-24h
and net > 0. Expected failure: spike = informed flow / price move, or LP
crowding kills yield. Falsified if median realized fee-yield ratio < 0.5 or
mean net ≤ 0.

**H3 — conditioned one-sided USDG bid.** Story: a bid below price earns fees
from sellers without an entry swap; the old generic bid failed in declining
tokens, so require balanced flow and no downtrend. Range [p·0.90, p·0.99],
USDG only. Eligible if G1–G8 (G4/G5 on the exit direction only) pass,
|buy − sell| / (buy + sell) quote volume ≤ 0.20 over 3 days, 7-day price drift
≥ 0, and the H1 persistence condition holds. Prediction: net vs USDG > 0.
Falsified if mean net ≤ 0 or worse than H1.

**H4 — regime separation.** Strata: major (both tokens in {USDG, WETH, ETH,
other ≥$1m/day stable/major}), established token (age ≥ 7 d), young token
(3–7 d). H1 is scored per stratum. A cross-stratum top-K is accepted only if
it improves both net NAV and max drawdown vs the best single stratum.

**C0 — naive control (expected to fail).** Rank eligible pools by trailing-24h
pool-wide fee USD. Exists to show whether any score beats the refuted rule.

## 6. Portfolio and reporting rules

Daily, in fixed order: exit matured positions; compute gates; rank; fill free
slots from the top, skipping a candidate that shares a token, issuer (token
deployer) or hook with a held position; abstain when nothing qualifies.
Report per policy: decisions, abstentions, entries, failed entries/exits, unique
pools, unique tokens, distinct profitable positions, profitable calendar days,
gross fees, inventory change, gas, net NAV vs (a) and (b), max drawdown, worst
position, capital-hours. Uncertainty: block bootstrap by calendar day and by
token. No APR is reported.

## 7. Stop / go

A policy is a candidate only if, on the untouched evaluation folds, net NAV vs
USDG is positive in ≥ 2 of 3 folds, the day-clustered 90% lower bound of mean
position net is > 0, and ≥ 3 distinct tokens contributed profitable positions.
Even then it stays blocked pending the prospective 30-decision shadow and fork
execution tests. Otherwise: no-edge conclusion.

## Amendment A1 — 2026-09-30, before any outcome was computed

Reason: the complete-log panel (≈30 M swaps, ≈30 GB) exceeds the 50 req/s RPC
budget. No hold-period outcome, trailing excess, or quote result had been
computed when this amendment was written.

1. **Hooked pools** (G2) are recorded in the panel as `REJECT: G2 UNVERIFIED`
   using screen statistics only; no further reads. They could never be
   investable under G2.
2. **State panel.** For every unhooked panel pool, archive reads at each UTC
   boundary: `getSlot0`, `getFeeGrowthGlobals`. The per-$ fee yield of a
   position that stays in range all day equals the global fee-growth delta
   times liquidity-per-$, which is an **upper bound** on the position's fee
   yield and therefore on H1/H2/H3 LP excess. A pool enters the complete-log
   stage only if on some decision day `3 × mean(bound, D-3..D-1) ≥ 0.9 × pool
   fee` (H1/H3) or `bound(D-1) ≥ 0.9 × pool fee` (H2). A round trip of the
   swapped half pays about the pool fee on the position, so pools failing the
   bound cannot pass H1–H3. The C0 control uses the top 5 pools per day by
   state-estimated 24 h pool fee USD.
3. **G5 and H3 clarifications.** All hypotheses use the same two-sided G4/G5
   liquidity gate. H3 ranks by the H1 score. H2 requires its rank value > 0.
4. **Scope.** Uniswap V4 PoolManager pools only. The large V3 memecoin pools
   (PONS, AI, CASHCAT WETH V3) were covered by prior studies and are out of
   scope here; any result is V4-specific.
5. **New hypotheses, frozen now:**
   * **H5 — maker-only range-order cycling.** Story: in high-fee pools a taker
     pays the 1–5% fee; a range order is *paid* it. Place a USDG-only bid range
     one tick-spacing band directly below the decision price (width = 2 ×
     tick spacing). If it is fully crossed (converted to token), withdraw and
     place a token-only ask range directly above the fill band (same width).
     When the ask is crossed, withdraw back to USDG and re-place a bid below
     the current price. Only positions fully on one side are ever withdrawn;
     reposition gas is charged at the p90 per-tx cost × 2 per repositioning.
     Eligibility: G1–G8 plus the H1 persistence condition (3 positive trailing
     excess days) at the decision day that opens a cycle. The cycle runs for
     exactly 3 days; any token inventory left at the end is sold with an
     exact V4Quoter exit quote at the exit block (taker cost counted).
     Prediction: net vs USDG > 0 and better than H3. Falsified if the mean is
     ≤ 0 or the bids fill mainly ahead of further declines (median post-fill
     24 h token return < −fee).
   * **H6 — measured flow toxicity (markouts).** Story: LPs gain when flow is
     noise (mean-reverting) and lose when it is informed (trending). For each
     trailing-3d swap, the 1-hour markout is the mid move in the taker's
     direction, in quote units, per unit notional. Realized LP spread =
     fee − markout. Eligible if G1–G8 pass, the volume-weighted realized
     spread > 0 on each of the 3 trailing days, and the H1 score > 0. Rank by
     volume-weighted realized spread × trailing fee yield. Falsified if the
     evaluation-fold mean net ≤ 0 or it is no better than H1.

## Amendment A2 — 2026-09-30, cost-bounded pilot slice (before outcomes)

The user capped RPC spend at about 30k requests (QuickNode 50 req/s plan).
The state panel runs on the **lean** panel only: estimated day volume
≥ $20,000 (USDG) or ≥ 6 ETH (WETH/ETH), unhooked. That is 1,471 pools; the
2,142 hooked pools are recorded as G2 UNVERIFIED. Boundaries run
2026-09-20..09-30 (31,418 reads). Decision days that can be scored are
therefore 2026-09-23..09-27 (3-day trailing features, 3-day hold ending by
2026-09-30 00:00), plus the prospective 2026-09-30 decision. This slice lies
inside fold F3, which is partially contaminated (six pools were inspected
by the prior agent), so it is **exploratory evidence only**. It answers
"does anything clear costs at all", not "is there a validated edge". Whether
to run the full panel (A/B) depends on this answer.

## Amendment A3 — 2026-09-30, out-of-sample test of H3 on untouched folds (before outcomes)

Context: the A2 slice falsified H1, H2, H5 and H6 in-slice and left H3 untested
(one scorable day, +$4.32/$100). The user approved about 50k RPC requests to
test the **frozen** rules on untouched folds F1 (2026-09-08..14) and F2
(2026-09-15..21). No threshold, range, hold, or gate changes.

1. Universe: all 1,471 lean unhooked pools. **No fee-bound prefilter** for this
   window: complete Swap logs are fetched for every lean pool for 2026-09-01..
   09-19, and for 09-20..09-24 for the pools not already fetched. This removes
   the prefilter's dependence on later state.
2. State: `feeGrowthGlobals` at every boundary 2026-09-01..09-19; `slot0` at
   each pool's first live boundary and at 09-19. Pools whose fee settings differ
   between those two reads get every boundary read. Observation behind this:
   across 09-20..09-30 no LP fee changed, but 117 pools had the protocol fee
   switched on around 09-22.
3. Outcomes scored: **H3 (primary)**, H1 and C0 (reference and control). H2, H5
   and H6, falsified in the slice, keep their features and flags in the ledger
   but are not re-scored, to save quotes.
4. H3 verdict (prereg section 7, applied to F1, F2, and F3 slice day 09-27):
   candidate only if mean net > 0 in ≥ 2 of 3 folds, the day-clustered 90% lower
   bound of the mean position net > 0, and ≥ 3 distinct tokens with profitable
   positions. Otherwise H3 is falsified and the V4 study concludes no edge at
   $200 scale under these mechanisms.

## Verdict log (append-only)

**2026-09-30, after A3 scoring.**
* Implementation defect found and fixed **before** any verdict: H3 bid ranges
  were snapped outward, so in wide-spacing pools 94 of 278 bids straddled the
  price and were credited with tokens they never bought (mean +$18.32 vs
  +$1.23 for clean bids). The fix makes the near edge snap inward so every bid
  is USDG-only, as this pre-registration specifies. It is enforced by an
  assertion. The slice (F3) was rescored with the same fix.
* **H3 — CANDIDATE (passes section 7 / A3 criteria).** F1 +$3.41, F2 +$4.00,
  F3 +$0.65 mean net per $100 per 3-day hold. Day-clustered 90% lower bound
  +$2.01 (F1+F2), +$1.90 (F1+F2+F3, 309 positions, 15 days). 55 tokens with
  profitable positions. Not launch-ready: the prospective 30-decision shadow,
  position-exact fee validation and fork execution tests are outstanding.
* **H1 — FRAGILE, not a candidate.** F1 +$1.16, F2 +$4.78, F3 −$6.89. 87% of
  the F1+F2 total comes from 5 tokens; the token-level mean is −$2.61.
* **H2, H5, H6 — FALSIFIED** in the slice. **C0 — fails** (control), F1 −$10.21,
  F2 −$1.99, F3 −$12.94.

## Amendment A4 — 2026-09-30, LP population and "profitable users" study (before outcomes)

Question from the user: find profitable Robinhood LP users on Krystal and the
formula behind them. Survivorship is the main hazard, so the whole population
is measured, not a leaderboard.

Data (read-only): every V4 `ModifyLiquidity` on the 1,471 lean pools and every
PositionManager NFT `Transfer`, 2026-09-01..09-29 (≈9.3k requests); the Krystal
public vault list (250 Robinhood vaults, snapshot
`research/huntx_krystal_rh_vaults_snapshot.json`); and the RAPTOR-X agent
playbook (`research/huntx_krystal_raptorx_instructions.json`).

Tests, frozen now:
1. **Population baseline:** deposit-weighted PnL vs USD and vs hold for all clean
   LP episodes (mid-price marks, validated fee model).
2. **Skill persistence:** owners with ≥ 5 episodes in both halves (opened before
   vs after 2026-09-15). Pass if the Spearman correlation of vs-hold returns is
   > 0.2 **and** the top-decile owners from the first half beat the second-half
   population on vs-hold return. Otherwise "profitable users" is mostly luck.
3. **Entry-feature rule:** feature buckets (duration, width, side, fee tier,
   quote, sender type) ranked on the first half only. The best bucket must be
   positive vs USD in the second half, and better than the population, to count.
4. **H7 (RAPTOR-X-style breadth harvester):** judged on-chain by the Krystal
   vault contracts that hold positions. Pass only if the Krystal-owned episodes
   beat the population vs hold in **both** halves and are positive vs USD in
   the second half. Krystal's displayed PnL is not evidence.

## Amendment A5 — 2026-09-30, causal clone of the breadth fee-harvester (before outcomes)

Motivation: A4 found Krystal RAPTOR-X-style vaults beat the population on-chain
in both halves. This tests whether their **published rules**, applied causally
by us with exact costs, reproduce the result.

Clone C, decided daily at 00:00 UTC using only prior logs and state:
* Universe: lean unhooked pools with fee > 0, age ≥ 3 d, quote USDG/WETH/ETH,
  and a sane price (|tick| < 700,000).
* Entry filters (RAPTOR-X "standard entry", trailing 24 h): pool LP fees ≥ $75;
  volume ≥ $7,500; fees / TVL-proxy ≥ 0.6%; volume / TVL-proxy ≥ 0.25; token
  24 h drawdown ≤ 35%. The TVL proxy is the value of the pool's active
  liquidity across ±50% of price (a documented approximation; Krystal's TVL is
  not on-chain). Entry quote loss ≤ 2.5% and reverse (exit) quote loss ≤ 4% at
  unit size.
* Rank by trailing 24 h fees / TVL-proxy. Units: $200 / K, K ∈ {1, 2, 3}, one per
  token, filling empty slots daily.
* Position: centered ±15%. At each daily boundary, if it has been out of range
  for the whole preceding day, re-center ±15% (swap cost: exact V4Quoter on the
  rebalancing swap; gas = 2 txs at the measured Krystal mean of $0.27/tx).
  Fees are swept daily and valued at mid, with token fees charged the pool fee.
* Horizon: each unit is held 5 days (decisions 2026-09-15..09-24, test half
  only), then closed with an exact exit quote. It is also reported marked at
  mid, which is Krystal's convention.
* Pass: mean unit net vs USD > 0 with a day-clustered 90% lower bound > 0,
  ≥ 3 profitable tokens, and a $200 K=2 or K=3 portfolio net > 0. Otherwise the
  harvester's edge is not reproducible by a causal rule at $200 scale.

**2026-09-30, after A4/A5 scoring.**
* A4 population study: skill persistence **PASS** (Spearman 0.26–0.27; first-half
  top decile +2.5–2.8% vs hold in the second half vs +0.5% for the
  population). Entry-feature rule **FRAGILE** (the winner depends on the
  data-quality rule). Krystal vaults beat the population on-chain in both
  halves **PASS at mid valuation** (second half +2.27% vs +0.59% vs hold).
* A5 causal harvester clone: **FALSIFIED.** 1,695 units, 185 tokens: mean −$2.08
  per $100 per 5 days at executable exit (90% day-cluster −5.77 … +1.46). The same
  units are +$1.14 at mid. $200 portfolios K=1/2/3: −$97 / −$98 / −$89. Higher
  fees/TVL buys more fees ($9 → $40) and much worse token drift (median −3% → −25%).
* Defects fixed during A5, before any verdict: rebalancing sizes overflowed at
  drained-pool prices (guarded: no rebalancing at |tick| ≥ 700k, swaps capped at
  holdings); token fees swept at a drained price are valued at 0.

## Amendment A6 — 2026-09-30 09:10 UTC, prospective forward test (before any forward outcome)

**Protocol.** Each UTC day D, after the D 00:00 boundary, a read-only job:
1. fetches D−1's complete Swap logs and boundary state for the fixed lean
   universe (1,471 unhooked pools, from the A2 panel; new pools are not added,
   which is a documented limitation);
2. computes decisions for D with the **frozen** H3 and H8 rules, using only data
   before D's decision block, and writes them to `research/huntx_forward/` with a
   hash chain (each day's hash covers the previous hash), so decisions cannot
   be edited after outcomes are known;
3. scores matured decisions (H3 after 3 days, H8 after 5) with exact V4Quoter
   exits at the maturity block, plus p90 gas. Nothing is ever signed or sent.

**H3 (frozen, unchanged):** conditioned USDG bid as defined in section 5 and
fixed in the verdict log (inward-snapped, USDG-only).

**H8 (new, frozen now; defined from A5's failure mode):** the A5 harvester unit
(centered ±15%, daily re-center, daily sweep, 5-day unit, exact costs) admitted
**only** where the pool passes all of the following:
* every A5 clone filter;
* all H3 gates G1–G8;
* trailing 3-day flow imbalance ≤ 0.20;
* 7-day token drift ≥ 0;
* all 3 trailing daily LP-excess values > 0.
Rank by fee/TVL. Story: harvest fees only where flow is two-way and the token is
not being sold down.

**Stop/go (per hypothesis, once ≥ 30 decision days are scored):** mean net per
$100 > 0 with a day-clustered 90% lower bound > 0, ≥ 3 distinct profitable
tokens, and a positive $200 K=3 shadow portfolio. H3 and H8 are judged
separately. Until then the HUNTX launch gate stays BLOCKED. The frozen
2026-09-30 H3 decisions (`research/huntx_edge_prospective_2026-09-30.json`) are
day 0 of this ledger.

**2026-09-30 ~10:00 UTC — execution validation (local fork; nothing broadcast).**
* Foundry 1.8.3 installed from the official GitHub release (sha256 verified).
* Token behaviour: all 97 tokens H3 has ever selected (in-sample, out-of-sample,
  day 0) pass three fork transfers: PoolManager → holder → holder → PoolManager
  (the sell path), each delivering exactly 100%. No transfer or sell tax,
  blacklist or revert; 1 token is gas-heavy (>150k gas).
  `research/huntx_fork_token_checks.py` / `.json`.
* Position-exact fees: our position was minted on a fork at the decision block
  and the recorded swaps replayed with it present. Model ÷ actual fees:
  centered ±15%, 6 cases / 616 swaps, median 1.000 (0.994–1.110); **H3 bids,
  8 cases / 627 swaps, median 1.039 (0.994–1.160)**. The model slightly
  **overstates** bid fees. H3 out-of-sample, haircut accordingly: median-case
  mean ≈ +$2.8 per $100 per 3 d (day-cluster lower bound ≈ +$1.4); worst-case
  (÷1.16 on every position) mean ≈ +$1.4, lower bound ≈ −$0.1.
  `research/huntx_fork_fee_validation.py`, `research/fork_validation/`.
* Status: H3 remains a candidate with a thin margin; the forward test (A6)
  decides it. The launch gate stays BLOCKED.

## Amendment A7 — 2026-09-30, loop iteration L1: launch-age LP edge with rug marking (0 RPC)

Reconnaissance (pool-level rug exclusion, so rugs were missing) showed vs-USD
per-episode returns falling with pool age at entry. L1 re-scores the same
population with **per-episode rug marking**: an episode opened at a degenerate
price is dropped; one still open when its pool becomes drained (|tick| ≥ 700k)
is marked as a total loss of its remaining value. Buckets: pool age at entry
(<1 h, 1–6 h, 6–24 h, 1–3 d, 3–7 d, >7 d) × position shape (side, width, hold).
Pass: the <1 h bucket is positive vs USD in **both** halves and above the >7 d
bucket in both halves. The shape inside <1 h with the highest vs-USD return in
the first half must also stay positive in the second half. A pass promotes
the winning (age, shape) cell to a causal rule test in L3 (unbiased launch
universe, executable exits). Mid-price values here are descriptive only.

**L1 verdict (A7): PASS (descriptive, mid-valued, panel-universe).** <1 h entry
+4.60% / +2.09% vs USD (first / second half) vs >7 d +0.66% / +0.12%. Only 267
episodes were open in drained pools. The best first-half <1 h cells stayed
positive in the second half: bid 10–40% width, 15 m–2 h hold +10.2% → +5.6%
(n 6,590 / 3,261); bid 40–150%, 15 m–2 h +13.6% → +5.7%; straddle 40–150%,
15 m–2 h +28.1% → +14.3% (n 1,371 / 183). Caveat: the panel universe was
selected partly on later volume, so this is survivorship-exposed. Promoted to L3.

## Amendment A8 — 2026-09-30, loop L3: causal launch-bid rule on the unbiased launch universe

Universe: **every** unhooked pool initialized 2026-09-15 00:00 .. 2026-09-25 00:00
UTC with USDG, WETH or native ETH as one currency and fee > 0 (from the full
registry; no volume screen). Swap logs cover each pool's first 3.2 h, fetched
with time-local OR-lists.

Rule L3-BID (primary). Decision at init + 30 min (17,850 blocks), using only
swaps before it. Enter if, in the first 30 min: ≥ 20 swaps; quote-leg volume
≥ $1,000; largest single swap ≤ 50% of that volume; price sane (|tick| < 700k).
Position: USDG/ETH-only bid band [0.70·p, 0.97·p] (edge nearest the price
snapped inward), $100. Hold exactly 2 h, then sell all tokens with an exact
V4Quoter quote at the exit block. Fees use the validated model at the pool's
event liquidity with our dilution, divided by 1.04 (fork-measured bid bias);
the ÷1.16 worst case is also reported. Gas 3 txs × $0.27. A drained or dead exit
is valued by its quote (≈ 0), so rugs count automatically.
Secondary L3-STRADDLE (reported, not selected on): centered ±40% with an
exact-quote entry swap, same filters, 2 h hold.

Pass (L3-BID): mean net > 0 with a day-clustered 90% lower bound > 0 over the
10 decision days; ≥ 10 profitable tokens; positive in both 5-day halves; and a
positive $200 portfolio (K = 3 concurrent $66.67 units, taken chronologically).
A pass sends L3-BID to the forward test (A6 extension) plus fork execution tests.

**A8 sampling note (before any outcome):** 11,621 of 62,884 launches pass the
entry filter (36,931 had any swap; 25,953 had none in the first 3.2 h). To stay
within the RPC budget, L3-BID is scored on a fixed-seed (seed 20260930) random
sample of 2,000 eligible units, stratified proportionally by decision day;
L3-STRADDLE on 500 of those. The worst-case haircut proceeds are scaled from the
single exit quote (out_worst = out × tokens_worst / tokens). The portfolio walk
uses all eligible units chronologically, but quotes only the positions it takes.

**L3 verdict (A8): FALSIFIED.** Unbiased launch universe 09-15..25, 11,621
eligible launches, 2,000 scored at executable exits. L3-BID: mean −$4.16 per $100
per 2 h (90% day-cluster −4.97 … −3.35), median −$0.81 (unfilled = gas only),
win rate 9.8%, negative on all 11 days. L3-STRADDLE: 377 of 500 entries
impossible (no route); scored units −$42.28. $200 K=3 portfolio: −$918 of
recycled capital over 357 positions. **L1's first-hour edge was survivorship**
(panel pools chosen on later volume) plus mid-price marks. Bids fill because
launch tokens are dumping.

**L2 verdict: CLOSED (not implementable; profit unverifiable).** Bot `0x56bf…` is a
contract with at most about $3k of working capital (peak $1,257 USDG + 0.56 ETH on
09-05; about $1 by 09-15), recycled over 89k positions. Its mid-marked +$411k is
not credible evidence, and a high-frequency maker is not a $200 vault strategy.

## Amendment A9 — 2026-09-30, loop L7: survivor launches (causal survival conditioning)

Only 1,289 of 36,931 traded launches (3.5%) still had ≥ 20 swaps in hour
2.2–3.2 after init; that set (known by 3.2 h) is the L7 universe. Logs are
fetched for hours 3.2–48 of each.
Decision at pool age 24 h (single decision per pool), using only prior swaps.
Enter if: ≥ 40 swaps in the trailing 12 h; trailing-12 h quote volume ≥ $2,000;
largest swap ≤ 25% of it; flow imbalance |buy − sell| / (buy + sell) ≤ 0.20;
token price at 24 h ≥ price at 6 h (non-negative drift since the launch phase);
|tick| < 700k. Position: H3-style USDG/ETH-only bid [0.90·p, 0.99·p], $100, held
24 h, then all tokens sold with an exact V4Quoter quote; fees ÷ 1.04; gas
3 × $0.27. Pass: charter breakthrough bar (mean > 0, day-clustered 90% lower
bound > 0, ≥ 10 profitable tokens if n permits, else reported as underpowered;
both 5-day halves positive; $200 K=3 portfolio positive).

**L7 verdict (A9): FALSIFIED.** 95 eligible survivors (64 tokens) of 1,289 still
active at 3 h: mean −$10.66 per $100 per 24 h (90% day-cluster −19.28 … −3.74);
filled bids (54%) −$27.89; $200 K=3 −$263 over 26 positions. Conclusion across
L3/L7: bids on launch tokens lose at 30 min, 1 h and 24 h, even with survival and
two-way flow observed. Only pools aged ≥ 3 d (H3) showed positive bid economics.
**L8 closed without scoring:** it is the same mechanism (bids filled by continued
launch selling), so it adds no new information.

**L4 verdict: CLOSED.** Launchpad hook pools (`0x4e34…` 79k Sept launches;
`0xe5e7…`) are issuer-managed. In a three-chunk sample the hook or launchpad
contracts made 3,961 + 1,222 + 268 liquidity changes and outsiders via
PositionManager made 8. The hooks take swap deltas. An outside LP there still
holds the same dumping launch tokens.

**Launch-focus conclusion (loop stop condition: queue exhausted).** Across L1–L8,
no causal rule for an outside LP on third-party Robinhood launches survives
rugs, executable exits and survivorship at $200 scale. Launches die fast
(96.5% silent by hour 3), and bids on launch tokens are filled by continued
selling at every age tested (30 min, 1 h, 24 h). The profitable launch roles
are the token-side liquidity of issuers and launchpads (who already own the
supply) and high-frequency makers with bespoke infrastructure. Neither is an
outside $200 LP strategy. Positive bid economics appeared only in pools aged
≥ 3 d (H3), which remains in the forward test.

## Amendment A10 — 2026-09-30, V-series: stock-token LP vault (frozen before any unit outcome)

Evidence that motivated it (pool-level, 0 RPC, `research/huntx_stock_sessions.py`):
108 canonical stock-token pools (30 symbols), about $700M of September volume. LP
realized spread (fee minus markout) is positive in every US session at 1 h, 4 h
and 24 h horizons (24 h: regular +16.5bp, pre-market +10.8, overnight +14.5,
weekend +24.3, after-hours +41.1). Informed flow concentrates in pre-market and
regular hours.

Vault tests (USDG-quoted, unhooked stock pools only; fee > 0; age ≥ 3 d;
|tick| < 700k; ≥ 100 swaps on each of the 3 trailing days). Decisions at 00:00 UTC,
2026-09-08..09-24. $100 units held 5 days. Centered **±5%** range (primary;
±2.5% and ±10% reported as sensitivity only). Re-center at a daily boundary
after a whole day out of range (exact V4Quoter rebalancing swap, 2 txs of gas).
Fees are swept daily and divided by 1.03 (centered fork-validation bias, rounded
up). Exit sells all tokens with an exact V4Quoter quote at the exit block. Gas
$0.27/tx. Hold baseline: the post-entry token mix, exited with its own quote.
* **S0 venue baseline:** every eligible pool-day.
* **S1 selection:** top 3 per day by trailing-3-day fee yield of a ±5% position.
* **S2 session-timed:** as S0, but liquidity is active only outside 08:00–20:00
  UTC on weekdays (withdraw before pre-market, re-mint at 20:00 centered on the
  current price without swapping, leftover idle). No fees and no LP trades
  while inactive; inventory is still revalued. 2 txs of gas per day.
Pass (for S0 or S2, and S1 judged on its own): mean net vs USD > 0 with a
day-clustered 90% lower bound > 0; mean LP-vs-hold > 0 (LP alpha, not stock
beta); ≥ 5 profitable symbols; both halves (decisions ≤ 09-15 vs ≥ 09-16)
positive; $200 K=3 portfolio positive. A pass goes to fork execution tests and
the forward test.

## Amendment A11 — 2026-09-30, M-series: management factorial to beat Krystal-style agents

Scope: stock-token USDG pools, A10 eligibility, $100 units, 5-day holds.
Factors (27 configurations):
* width: ±2.5%, ±5%, ±10% (centered at entry);
* rebanding after a whole day out of range: **swap50** (swap back to the
  centered ratio, as Krystal/RAPTOR-X does), **maker** (no swap: place a
  one-sided range of the same total width adjacent to the price on the side that
  re-accumulates, i.e. a quote-only bid below after a rise, a token-only ask above
  after a fall), **static** (never reband);
* session: **always**, **toxic_off** (inactive 08:00–20:00 UTC weekdays),
  **prime_only** (active only 20:00–24:00 UTC weekdays and all weekend).
Krystal-like baseline for the head-to-head: ±10%, swap50, always.

Protocol:
1. **Screen** all 27 on discovery decisions 2026-09-08..09-15 with paired units
   (same pool-days for every configuration). Costs are modeled: each swap or
   exit pays pool fee + price impact, with impact measured from the unit's exact
   entry quote. Fees ÷ 1.03, gas $0.27/tx.
2. **Select** the configuration with the highest mean net vs USD whose mean
   vs-hold is > 0. The selection is frozen before step 3.
3. **Confirm** on untouched decisions 2026-09-16..09-24 with exact V4Quoter
   entry, rebalancing and exit, for the selected configuration and the
   Krystal-like baseline on the same pool-days.
Pass ("beats Krystal"): selected − baseline paired difference has a
day-clustered 90% lower bound > 0 **and** the selected configuration's net vs
USD has a lower bound > 0, with ≥ 5 profitable symbols.

**A10 verdict: FAIL at the pre-registered gas ($0.27/tx), LP alpha positive.**
S0 ±5% (531 units, 29 symbols): net −$0.49 per $100 per 5 d (90% −0.82 … −0.16),
**LP vs hold +$0.31**, fees $1.75, gas $1.16. ±2.5%: net −$0.27 (90% −0.59 … +0.04),
vs hold +$0.51. ±10%: −$0.58 / +$0.21. S1 top-3: −$0.40 (median +$1.34), vs hold
+$0.20. S2 session: −$2.65 (gas $2.97). $200 K=3: −$12. The venue's LP alpha is
positive; fixed costs (Krystal-level gas, per-unit conversions) sink $100 units.

## Amendment A12 — 2026-09-30, gas is measured, not assumed (before the A11 screen runs)

$0.27/tx is Krystal's measured mean for its multicall agent transactions. A lean
HUNTX module would call the PoolManager directly. Before the A11 screen is run,
the per-action gas of our own mint, burn and swap is measured on a local fork
(FeeReplay harness, gasleft deltas at the unlock boundary, plus 21,000 base gas)
and priced at the p90 effective gas price of real PositionManager transactions
(measured 2026-09-30: p90 1.982e-5 ETH per 253,829-gas median tx). A11 selection
and confirmation use that **measured** per-tx cost. All A11 results are also
reported at $0.27/tx. A10 verdicts are **not** revised.

**A12 gas measurement (fork, 2026-09-30):** lean direct-PoolManager actions on
the META/USDG 0.30% pool: mint 260,550 gas, swap 124,195, burn 175,036, each +21,000
base. At the p90 effective gas price of 0.022456 gwei (60 real txs, no L1
component on RH), that is **$0.0125/tx mean** at ETH $2,677
(`research/huntx_measured_gas.json`).

**A11 screen (discovery 09-08..15, 254 paired units, modeled costs, measured
gas) — SELECTION FROZEN before confirmation:** `±2.5% | static | always`, mean
+$1.21 per $100 per 5 d (90% +0.54 … +1.82), vs hold +$1.43, win 70%.
Krystal-like baseline `±10% | swap50 | always`: +$0.47 (90% −0.04 … +1.01).
Factor pattern: narrower is better; swap-to-rebalance is worst; session gating
loses more fee volume than it saves in toxicity. Confirmation on 09-16..24 with
exact quotes is now running.

**A11 confirmation (untouched 09-16..24, exact quotes, measured gas):** selected
`±2.5%|static|always` n=277, net **+$0.611** per $100 per 5 d (90% day-cluster
**+0.266 … +0.922**), median +$0.967, vs hold +$0.731, win 73.6%, 18/26 symbols
profitable. Krystal-like baseline +$0.472 (90% −0.093 … +1.059). Paired
selected − baseline +$0.139 (90% −0.240 … +0.505), 56% of pairs.
**Verdict: "beats Krystal" NOT proven. Stock-token narrow LP = CANDIDATE**
(positive, lower bound > 0, 18 symbols, LP alpha > 0). Pending: ±2.5%
fork fee validation, a $200 portfolio test, and the forward test.

**±2.5% stock fork validation:** 10 cases / 1,241 swaps, model ÷ actual fees
median 1.0002 (0.950–1.140). The ÷1.03 haircut is conservative at the median.

## Amendment A13 — 2026-09-30, $200 stock-LP portfolio (frozen before scoring)

Config `±2.5%|static|always`, measured gas, exact quotes, decisions
2026-09-16..09-24 (untouched half). Each day, fill free slots with the eligible
stock pools ranked by trailing-3-day fee yield of a ±2.5% position, one per
symbol, 5-day units of $200/K. K ∈ {3, 5}. Pass: both K positive in total, and
more than half the positions profitable.

**A13 verdict: FAIL as written (K=3 −$0.81; K=5 +$1.39).** Positions: K3 5/6
profitable, K5 8/10. One NFLX unit (−$5.36 on $66.67) drove K3 negative. Only two
5-day rounds fit in the window, so this is underpowered. Single-name moves are
the tail risk; breadth mitigates them.

## Amendment A14 — 2026-09-30, stock-LP vault added to the forward test (frozen)

**SLP25** (evaluated alongside H3/H8 in the A6 forward job): each UTC day, among
stock-token USDG pools passing A10 eligibility, fill free slots of a $200
**K=5** book (one position per symbol, 5-day units of $40) ranked by the
trailing-3-day fee yield of a ±2.5% position. Position `±2.5%|static|always`,
exact V4Quoter entry and exit, fees ÷1.03, measured gas $0.0125/tx. Every
eligible pool-day is also scored as a $100 unit (population test). Stop/go after
≥ 30 decision days: population mean net > 0 with a day-clustered 90% lower bound
> 0, LP vs hold > 0, ≥ 10 profitable symbols, and a positive $200 K=5 book with no
single position below −10% of the book.

## Amendment A15 — 2026-09-30, SLP-v2 continuous-vault policy simulation (frozen before running)

Purpose: test **continuous operation** (conversions paid once) and the proposed
controller policy, not 5-day units. Window: 2026-09-04 00:00 → 2026-09-29 00:00
UTC, $200. At 09-04, pick the top K=5 symbols by trailing-3-day fee yield of a
±2.5% position (one pool per symbol: the symbol's pool with the highest such
yield). Equal-weight sleeves.
* **SLP-v2:** ±2.5% centered at entry. If the price stays outside the range for
  ≥ 24 h (checked hourly, on the pool's own price), reband after a ≥ 24 h cooldown
  to a one-sided range of the same total width next to the price on the side of
  the asset held (no swap). Fees are compounded daily when they add liquidity
  (no swap; the remainder stays idle). Exit all at the end with exact quotes.
* **SLP-v2-vol:** as SLP-v2, with half-width = clamp(1.0 × trailing-3-day daily
  σ of the pool price, 2.5%, 6%), fixed at each (re)band.
* **Krystal-like continuous:** ±10% centered; on a 24 h breach, swap back to 50/50
  (exact quotes) and re-center; fees harvested to cash; 24 h cooldown.
* Baselines: hold USDG (0); equal-weight hold of the same 5 stock tokens
  (exact entry and exit quotes).
Measured gas $0.0125/tx, fees ÷ 1.03. Reported for the full window and for
09-04..15 / 09-16..29 marks. **Caveat, stated before running:** width and
reband style were selected on 09-08..15 data, so this is partly in-sample; the
forward test (A14) remains the primary evidence.

**A15 result (partly in-sample, stated before running):** $200, 09-04 → 09-29,
picks SNDK/TSM/AMD/PLTR/MSTR (causal at 09-04). SLP-v2 +$8.91; **SLP-v2-vol
+$10.73**; Krystal-like continuous +$9.74; hold same stocks **−$21.12**; hold
USDG $0. Marks at 09-16: +2.53 / +3.29 / +0.35. Continuous stock LP earned about
+5% while its stocks fell 10.6%. Management differences (±$1) are within noise.
The venue and lean execution are the edge vs Krystal-style agents.

## Amendment A16 — 2026-09-30, profit optimization of the continuous stock-LP vault (frozen before running)

Engine: the A15 continuous simulator (hourly stepping, one-sided maker rebands
after a 24 h breach with a 24 h cooldown, daily no-swap compounding, exact entry
and exit quotes, measured gas $0.0125/tx, fees ÷ 1.03), $200, horizon 9 days.
Rolling starts: 09-04, 09-07, 09-10 (**selection set**) and 09-13, 09-16, 09-19
(**confirmation set**; each ends by 09-28).
Grid (8 configurations):
* width ∈ {±1%, ±1.5%, ±2.5%, vol = clamp(1.0 × trailing-3-day daily σ, 1.5%, 6%)};
* K ∈ {5, 8} symbols (top-K by trailing-3-day fee yield of a ±2.5% position at
  the start, one pool per symbol, equal weight).
Selection: the highest mean net over the selection-set starts, provided its
worst start is > −2% of capital. Confirmation: its mean net over the
confirmation-set starts must be > 0, and it must beat the A15 reference
configuration (±2.5%, K=5) on at least 2 of 3 confirmation starts.
Separately (descriptive): an **SGOV/USDG cash sleeve** at ±0.5% and ±1.0%,
continuous 09-04 → 09-28, vs holding USDG and vs holding SGOV.

**A16 verdict: PASS.** Selected `±1% | K=8` (selection mean +$6.17 per 9 d on $200;
worst +$2.57). Confirmation starts 09-13/16/19: +$9.14 / +$7.87 / +$6.27 (mean
+$7.76), beating the ±2.5%/K5 reference on 3/3. All 48 grid runs were positive.
±1% fees fork-validated (12 cases, 1,381 swaps, model ÷ actual median 1.000,
0.94–1.11). Windows overlap, so the starts are not independent.
SGOV/USDG cash sleeve 09-04 → 09-28: ±0.5% +$2.24, ±1% +$1.21, hold SGOV +$0.18.

## Amendment A17 — 2026-09-30, forward test of the optimized book (frozen before 2026-10-01)

**SLP10-K8 continuous book** (added to the daily A6 forward job): at the first
forward decision (2026-10-01 00:00 UTC), pick the top 8 stock symbols by
trailing-3-day fee yield of a ±2.5% position among A10-eligible USDG pools (one
pool per symbol, equal weight), $200. The picks are frozen with a hash. Run the
A15/A16 continuous engine: ±1% (snapped outward), one-sided maker reband after a
24 h breach with a 24 h cooldown, daily no-swap compounding, exact entry quotes,
measured gas, fees ÷ 1.03. Each day, record the book's exact-exit value (V4Quoter
at that day's boundary) versus holding USDG and holding the same 8 stocks.
Verdict after 30 days: exit value > $200 and > the stock-hold value, with no
single sleeve below −10% of its capital.

## Amendment A18 — 2026-09-30, beta control (frozen before running)

Mechanism: the SLP10-K8 book carries about 50% stock inventory, so its USD result
follows the market (09-25 → 09-29: book −$3.98 vs hold −$9.43). Reducing the
inventory held while keeping fee capture should lift USD returns in down
windows at a modest fee cost.
Variants (all $200, 9-day continuous runs, same engine, exact entry and exit):
* **B0** SLP10-K8 (current best, control).
* **B1** 70% B0 book + 30% SGOV/USDG ±0.5% cash sleeve.
* **B2** bid-skewed ranges: token-price band [0.985p, 1.005p] at entry (mostly
  USDG, buys dips), maker rebands with the same total width, K=8.
* **B3** B2 with the 30% SGOV sleeve.
Starts: selection 09-04/07/10; confirmation 09-13/16/19 and the down window
09-20 → 09-29. For each window, also record the exact-quote hold-stock result
of the same picks, and report beta = slope(book net vs hold net).
Replace B0 only if a variant, on the confirmation set, has mean net ≥ 90% of B0,
worst-window net ≥ B0's, and down-window net ≥ B0's. Otherwise B0 stays and the
variants are logged as tried.

**A18 verdict (frozen rule applied exactly): B2 REPLACES B0 as the current best.**
Confirmation mean: B0 +$6.065, B1 +$3.707, **B2 +$5.630** (≥ 90% of B0), B3 +$3.389.
Worst/down window: B0 +$0.977, **B2 +$1.343**, B1 +$0.153, B3 +$0.389. Selection
means: B0 +$6.175, B2 +$4.185. Margins are thin: the 7-window mean is B0 $6.11 vs
B2 $5.01. Beta of window net vs holding the same stocks: B0 −0.09, B2 −0.07
(≈ 0 over 9-day windows; e.g. 09-16 window hold −$15.43, B0 +$7.87). The SGOV
mix (B1, B3) dilutes profit without a downside benefit: logged as tried, rejected.

## Amendment A19 — 2026-09-30, forward test adds B2 (frozen before 2026-10-01)

The forward job also runs **SLP-SKEW-K8**: the same frozen A17 picks and engine,
with bid-skewed token-price band [0.985p, 1.005p] at entry and maker rebands of
equal total width. Valued daily at exact exit alongside SLP10-K8. After 30 days,
the book with the higher exit value (with no sleeve below −10%) becomes the
production policy candidate; if the two differ by < $1 on $200, prefer the
lower-drawdown book.

## Amendment A20 — 2026-09-30, capacity (descriptive; no selection)

Books B0 and B2, the same 7 A18 windows and picks, total size $200, $2,000 and
$20,000 (equal weight across 8 sleeves). Report net % per window by size. The
engine models our dilution (L_ours / (L + L_ours)) and uses exact entry and exit
quotes at each size. Limitation, stated up front: at large sizes our own liquidity
would slow the price path, which is not replayed. Fork validation covered only
$100-scale positions, so large-size fee estimates are optimistic.

**A20 result (descriptive):** mean / worst net per 9 d. B0: $200 +3.06% / +0.49%;
**$2k +3.27% / +0.45%**; $20k −0.23% / −13.60%. B2: $200 +2.51%; $2k +2.84%; $20k −0.29%.
At $20k, 6 of 7 windows stay positive (+0.1% to +3.4%). The failure (09-20 window)
is one sleeve: META picked in a thin 0.052% pool (active L 6.0e17), −$2,498 of
$2,500, because entry and exit were forced through that same pool. META's main
0.30% pool is deep. Capacity is limited by pool choice and routing, not the fee
edge.

## Amendment A21 — 2026-09-30, depth-aware pools + best-pool routing (frozen before running)

Mechanism: capacity is lost to forced single-pool conversion in thin pools.
Variant **D1** (built on B0: ±1%, K=8, maker rebands):
* Pool choice per symbol at the start: among that symbol's A10-eligible USDG
  pools, rank by trailing fee yield, but skip any pool whose exact reverse quote
  (sell the sleeve-size token amount back to USDG at the start block) loses
  > 1.0% beyond its fee tier. A symbol with no qualifying pool is skipped and the
  next symbol takes its slot.
* Entry and exit conversions use the best exact quote among **all** of that
  symbol's USDG pools in the panel (the LP stays in its chosen pool).
Evaluate D1 vs B0 at $2k and $20k on the 7 A18 windows (same starts).
Pass: D1 at $20k has mean ≥ +1.5% per 9 d and worst window ≥ −2%, and D1 at $2k
has mean ≥ B0 at $2k minus 0.2 pp. A pass makes depth-aware routing part of the
production policy and raises the documented capacity.
