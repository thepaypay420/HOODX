# HUNTX research loop — pathway ledger and charter

This is the single source of truth for the research loop. **Every iteration
reads this file first and updates it last.** A path marked EXHAUSTED is not
retried unless a new, specific reason is written next to it.

## Goal

Profit from LPing **new launches** on Robinhood Chain with a causal, repeatable,
multi-position rule that survives rugs, executable exit costs and gas at $200
scale. The HUNTX launch gate stays BLOCKED until the breakthrough bar is met
**and** the forward test confirms it.

## Breakthrough bar (all required)

1. The rule is frozen in `docs/HUNTX-EDGE-PREREGISTRATION-2026-09-30.md` before
   its evaluation data is scored.
2. Decisions use only information before the decision block (no survivorship:
   the launch universe includes pools that later rug or die).
3. Positive mean net at **executable** exit (V4Quoter at the exit block) after
   gas, with a day-clustered 90% lower bound > 0 on **untouched** dates.
4. ≥ 10 distinct profitable tokens, and a positive $200 portfolio (K ≤ 3).
5. Positions still open in a pool that becomes drained (|tick| ≥ 700k) are
   marked as a **total loss**.
6. Fees are fork-validated for the position type (apply the measured haircut).

## Standing rules

* Read-only chain research and local forks only; never sign or broadcast.
* RPC budget: ≤ 10k requests per iteration by default. State the count before
  any larger fetch and prefer data already on disk. The QuickNode cap is 50/s.
* Pre-register every hypothesis (append an amendment), then test, then record
  the verdict here and in the pre-registration verdict log.
* Mid-price marks are never evidence of profit. Always report executable values.
* Report to the user after each iteration: path, verdict, numbers, next path.

## Data on disk (reuse first)

| Data | Location | Coverage |
|---|---|---|
| V4 pool registry (932k pools) | `huntx_edge_registry.json.gz` | to 2026-09-29 |
| Swap logs, lean 1,471 pools | `huntx_edge_logs*` (npy) | 09-01 .. 09-29 |
| Boundary state (fee growth, slot0) | `huntx_edge_state_panel.json.gz` | 09-01 .. 09-30 |
| All LP episodes (1.31M) + owners | `huntx_lp_population/` | 09-01 .. 09-29 |
| Krystal vault list + RAPTOR-X rules | `huntx_krystal_*` | snapshot 09-30 |
| Forward shadow ledger | `huntx_forward/` | from 09-30, daily |
| Quote/state cache | `huntx_edge_rpc_cache.json.gz` | — |

## EXHAUSTED paths (do not repeat)

| Path | Evidence | Why it failed |
|---|---|---|
| Launch-token swap probes, top-2 by day | `HUNTX-V3-CAUSAL-EDGE-REVIEW` | Hindsight; causally −10.8% of NAV |
| Generic one-sided WETH bid, fee/calm filters | `HUNTX-RESEARCH-LOOP-2026-09-29` | −6 to −17 pp per fold |
| Static LP ranked by displayed APR / volume / fees | old replay (void), C0 | Fees paid by dumping tokens |
| Old `krystal_multi_pool_lp_replay` | fee validation | Wrong fee token; void |
| H1 persistent fee flow | slice + OOS | Anti-predictive; 87% from 5 tokens |
| H2 fee/liquidity spike | slice | −$14.70 / $100 |
| H5 maker-only range-order cycling | slice | Drift, not fills |
| H6 low-toxicity markouts | slice | ≈ H1 |
| H7/A5 RAPTOR-X harvester clone | `huntx_harvester_clone.py` | −$2.08 / $100 at exit; Krystal "profit" = mid marks |
| Copying Krystal leaderboard vaults | population study | Correlated copies; mid-marked |
| **L1→L3 LP any launch in hour 1 (bid or straddle)** | `huntx_launch_l3.py`, 2,000 of 11,621 launches | −$4.16 / $100 per 2 h (bid), −$42 (straddle); L1's +2–5% was survivorship |
| Population "early entry" stats as evidence | L1 vs L3 | Panel universe selected on later volume = survivorship |
| **L7 survivor launches (24 h, survival + two-way flow observed)** | `huntx_launch_l7.py` | −$10.66 / $100 / 24 h; filled bids −$27.89 |
| **L8 post-dump bids on launches** | mechanism = L3/L7 | Closed unscored: bids on launch tokens are filled by continued selling |
| **Any LP that ends up holding third-party launch tokens (< 3 d old)** | L3, L7, H1-young stratum | Launch tokens dump; 96.5% dead by 3 h |

## ACTIVE

* **H3** (conditioned USDG bid, established pools) and **H8** (harvester gated by
  H3 conditions): daily forward test, scheduled task, verdict after 30 scored
  days (≈ early November). Fork-validated: bid fees overstated by a median of 4%.

## OPEN QUEUE — new launches (ranked by information per RPC)

| ID | Path | Cost | Question |
|---|---|---|---|
| L1 | Launch-age LP outcome with **per-episode rug marking**, split by side, width and hold, both halves | 0 RPC | Does the "enter in hour 1" edge survive rugs? Which position shape carries it? |
| ~~L2~~ | DONE: closed. Bot `0x56bf…` is a contract with ≈ $3k of working capital recycled 89k times; mid-marked +$411k is not credible; high-frequency making is not a $200-vault strategy | — | — |
| ~~L3~~ | DONE: falsified (see EXHAUSTED). The unbiased launch dataset (first 3.2 h of 62,884 launches) is on disk in `huntx_launch_l3/` | — | — |
| ~~L7~~ | DONE: falsified. **Survivor launches:** pools aged 6 h–3 d that are *still* active and not trending down at decision time (causal survival conditioning). Extend the L3 logs to 72 h only for launches still trading at 3 h | ≈ 3–5k | Does the edge appear once survival is observed rather than assumed? |
| ~~L8~~ | CLOSED (mechanism duplicate). **Post-dump mean reversion:** bid only after a launch has already fallen ≥ X% from its first-hour peak, with volume still two-way (uses the L3 data on disk) | 0 screen + ≈ 2k quotes | Are dumps followed by bounces that pay a bid? |
| ~~L4~~ | CLOSED: issuer-managed (outsider liquidity events 8 of about 5.4k in the sample). Launchpad hook pools (`0x4e34…` 79k/month, others): can outsiders LP? Fee split? | < 1k | Is the biggest launch venue even accessible? |
| L5 (deprioritized) | Exit-cost curve for young tokens at $10–$100 (mid vs executable gap by pool age) | ≈ 2k | How much of the early-LP mid edge is real at exit? |
| L6 (not implementable) | Short-hold (< 1 h) narrow bids in launch bursts vs hold/quote costs | 0–2k | Is the edge a speed game HUNTX cannot play? |

## Iteration log

* **2026-09-30 artifact reconciliation (0 RPC; no new outcome).** The earlier
  static Krystal replay handoff, saved JSON, script entry point, and canvas are
  explicitly marked VOID to prevent their invalid fee-side rankings from being
  reused. The H3 forward ledger still has zero matured exits; no decision rule,
  APR, or launch gate changed.

* **2026-09-30 #0 (reconnaissance, 0 RPC).** In the population data (drained
  pools excluded at pool level, so rugs are MISSING), vs-USD return per episode
  falls monotonically with pool age at entry: <1 h +4.9% / +2.1% (first / second
  half), 1–6 h +3.2% / +1.0%, >7 d +0.7% / +0.1%. 387k pools were initialized in
  September (256k unhooked; hook `0x4e34…` 79k). Bot `0x56bf…`: 89,781
  episodes, 102 tokens, narrow (4%) USDG bids, 1.6 h holds, half in a pool's
  first day, +2.85% vs USD at mid; it stopped on 09-08. **Next: L1.**
* **#1 L1 (0 RPC): PASS, descriptive.** With per-episode rug marking, <1 h entry
  is +4.6% / +2.1% vs USD (halves) vs >7 d +0.7% / +0.1%. First-hour wide bids
  held 15 m–2 h: +10.2% → +5.6% (10–40% width), +13.6% → +5.7% (40–150%).
  Mid-valued and panel-universe (survivorship-exposed), so it is not evidence
  alone. **Promoted: L3 (A8 frozen).** L1 status: DONE.
* **#2 L3 (≈ 7.4k RPC): FALSIFIED.** All launches 09-15..25: first-hour bid
  −$4.16 / $100 per 2 h (win 9.8%, negative every day); straddle −$42; $200
  portfolio −$918 recycled. L1 was survivorship. New paths added: L7 (survivor
  launches, causal survival), L8 (post-dump bid). **Next: L2 (0 RPC)**, to see
  what the one profitable launch bot conditioned on, which informs L7/L8.
* **#3 L2 (≈ 40 RPC): CLOSED.** Bot `0x56bf…` peaked at about $1.3k USDG + 0.56 ETH
  and was drained to about $1 by 09-15, over 89k positions. Its mid-marked +$411k is
  not evidence, and it is not implementable at HUNTX scale. Fact found: only 1,289
  of 36,931 traded launches (3.5%) are still active at hour 3.
  **Next: L7 (A9 frozen), fetching 1,273 requests.**
* **#4 L7 (≈ 1.5k RPC): FALSIFIED.** Survivors at 24 h: −$10.66 / $100; filled
  bids −$27.89; $200 −$263. L8 closed as a mechanism duplicate. **Structural
  finding:** on launches the profitable LP side is the *token-side* (ask)
  liquidity of whoever already holds the token (issuers and launchpads), not the
  bid side. **Next: L4** (launchpad hook pools: who LPs there, can outsiders, is
  the fee split different), < 1k RPC.
* **#5 L4 (≈ 6 RPC + Blockscout): CLOSED.** Launch venues are issuer-managed; the
  hooks take swap deltas.
* **LOOP STOPPED (queue exhausted) — launch conclusion:** no outside-LP edge on
  third-party launches at $200 scale. The remaining live candidate is H3
  (pools ≥ 3 d) in the forward test. **Re-open this file only with a
  genuinely new mechanism**, e.g. HUNTX owning token-side supply (issuer or
  maker-exit role), or new chain data showing launch survival rates changing.

## VAULT PATHWAYS (opened 2026-09-30 at the user's request: "regular proven vault strategies, beat Krystal")

| Path | Status | Evidence |
|---|---|---|
| Asset-class map (majors / stables / stocks / memes) | DONE | Stocks are the steadiest class; majors ≈ 0 vs hold |
| Stock-token flow toxicity by US session | DONE | LP spread +10 to +41bp at 24 h in every session |
| Stock LP vault S0/S1/S2 at $0.27 gas | FAIL (fixed costs) | LP alpha +$0.2–0.5 per $100 per 5 d |
| Gas measured on fork | DONE | $0.0125/tx lean vault |
| Management factorial (27 configs) | DONE | ±2.5% static best; swap-rebalance worst; session gating hurts |
| **SLP25 confirmation (untouched)** | **CANDIDATE** | +$0.61 per $100 per 5 d, 90% +0.27 … +0.92, 18 symbols |
| Beats Krystal-like manager (paired) | NOT PROVEN | +$0.14, 90% −0.24 … +0.51 |
| $200 portfolio | UNDERPOWERED | K3 −$0.81, K5 +$1.39 |
| **SLP25 forward test** | **ACTIVE (A14)** | Daily scheduled task |
| Open, not yet tested | QUEUED | earnings-calendar exclusion; continuous operation; after-hours skew; stable-pair baseline |

## VAULT LOOP CHARTER (from 2026-09-30; supersedes the launch focus)

**Current best (frozen): SLP10-K8** = ±1% ranges, 8 stock/USDG V4 pools, one-sided
maker rebands after a 24 h breach, daily no-swap compounding. Forward-tested from
2026-10-01 (A17). Known risk: about 50% stock beta.

**Anti-overfitting rules (mandatory each iteration):**
1. ≤ 4 variants per iteration, pre-registered with the selection rule before
   running. Every variant tried is logged here, winners and losers alike.
2. Selection starts 09-04/07/10; confirmation starts 09-13/16/19 plus the down
   window 09-20 → 09-29. Replace the current best only if the variant wins on the
   confirmation set **and** does not worsen the worst start or the down window.
3. Judge on the mean **and** the downside (worst start, down window, beta vs
   holding the same stocks). Never on the best start.
4. Mechanism first: each variant needs a first-principles reason, written
   before running. Any threshold sweep beyond 4 values is data mining; don't.
5. Forward data (A14/A17) outranks backtests once ≥ 10 days exist. After that,
   backtest-only changes need forward confirmation.
6. RPC ≤ 10k per iteration; read-only; never sign or broadcast.

**Vault queue (ranked by expected information / cost):**
| ID | Idea | Mechanism | Status |
|---|---|---|---|
| V-B | Beta control (A18) | Hold less stock inventory | DONE: B2 bid-skew replaces B0 by rule (thin margin); SGOV mixes rejected; beta ≈ 0 over 9-day windows. Both B0 and B2 in the forward test (A19) |
| V-C | Earnings / event avoidance | Single-name gaps (NFLX-type) drive tail losses | Needs an earnings calendar (external data) |
| V-D | Session-aware width (A22) | Toxicity is 4× lower after-hours | REJECTED: re-minting strands capital (conf +$1.29 / +$2.33 vs B2 +$5.63) |
| V-E | Weekly rotation (A23) | Fee yield decays | REJECTED: +$0.015 mean, worse worst |
| V-F | Capacity (A20) + depth routing (A21) | Dilution and forced thin-pool conversion | DONE: +3.1–3.3% per 9 d at $200–$2k; $20k broken by a thin pool (−13.6%) and fixed by routing (+1.92% mean, worst −0.46%). A21 formally FAIL on the $2k criterion (−0.08 pp). Best-pool routing adopted (dominant by construction); depth filter size-dependent |
| V-G | Majors (ETH/USDG) at ±0.5% in low-volatility hours | Huge volume, tiny fee; vs hold ≈ 0 so far | Low prior |

* **Vault iteration A18 (beta control, ~1k RPC):** B0 conf +6.07 / worst +0.98; **B2**
  conf +5.63 / worst +1.34 (replaces by rule); B1 +3.71; B3 +3.39. Window-net beta vs
  hold ≈ 0 (−0.09). Tried and rejected: SGOV mixing (B1, B3). **Next: V-F capacity (≈ 0.5k RPC).**
* **Vault iteration A20/A21:** capacity is about $2k at full edge and about $20k with best-pool routing
  (+1.92% per 9 d). A21 FAIL by rule (narrow). **Next: V-D session-aware width (A22).**
* **Vault iteration A22 (session width):** rejected (W1 conf +1.29, W2 +2.33; worst −3.6 / −4.5).
  **Next: V-E weekly rotation (A23).**
* **Vault iteration A23 (rotation):** rejected. **LOOP STOPPED: backtest queue exhausted on September
  data.** Production candidate = static ±1% K8 + maker rebands + best-pool routing. Next evidence comes
  from the forward test (A17/A19 books, daily). Re-open with new data (≥ 10 forward days) or a new
  mechanism: earnings-calendar exclusion (needs external data), majors at low volatility (low prior).

## PROFIT LOOP v2 CHARTER (2026-09-30, user: "higher profit, breakthrough discoveries")

Target: raise dollar profit = (net yield per $) x (TVL the edge supports) + protocol fee,
without buying it with overfitting. September return-tuning is CLOSED (see conclusion above).
Admissible evidence, in priority order:
1. Forward data (daily shadow books, from 2026-10-01). Outranks everything after 10 days.
2. Deterministic fork measurements (costs, gas, routing, capacity at current depth).
3. Structural backtests where the answer is driven by depth/dilution, not by the month.
Every test is pre-registered (≤ 4 variants, frozen rule, hash-chained) and logged win or lose.

Queue (ranked by expected $ uplift / cost):
| ID | Lever | Mechanism | Evidence type | Status |
|---|---|---|---|---|
| A24 | Breadth for capacity | More pools = less dilution per pool -> higher cap | structural backtest | DONE: K8 to $10k (conf +2.02%/9d, worst -0.13); K16 only at $20k (+1.77 vs +1.38). Cap $2k->$10k supported by rule; forward-confirm first |
| R1 | Cheapest entry/exit route per stock | 0.35% round trip is ~12% of a 9-day return; cheaper pools exist | fork quotes (deterministic) | DONE: only 8/36 stocks round-trip <= 30bp (NVDA 4bp ... USO 30bp); 8 at ~70bp; 15 cost 1.2-10%; 4 no pool. Swap route = cheapest pool (adopted). Entry-cost gate -> A26 forward |
| A26 | ETH-entry cost gate | Expensive-to-enter picks hand the edge to arbitrage | forward (from 10-01) | WIRED into forward job (9-day cohorts 10-01/10/19/28, scored after ETH entry+exit) |
| A25 | Earnings exclusion | Known gap events are pure LVR | forward (Oct 21-29 cluster) | WIRED (same cohorts; calendar research/huntx_forward/earnings_calendar.json, re-verify <= 7 d before 10-10/19/28) |
| V-N | Where does flow go? | Venue choice | local swap logs (0 RPC) | DONE: Sept stock flow $634M, LP fees $1.88M. Flow is NOT cheapest-first: 0.25-0.30% pools 54% vol / 53% fees; 1% pools 8.8% vol / 30% fees (often the only venue); <=5bp pools ~25% vol / 3% fees. New Sept pools took 29.5% of 2nd-half volume (SPCX 78%, META 37%, CRCL/EWY/SGOV 100%) |
| V-N2 | Own hookless pool (vault = sole LP) | Capacity limit is dilution of others' pools; a sole-LP pool has none and sets its own fee (e.g. 0.30% vs a 1% monopoly). No hook -> no Cork-class risk | cross-section of Sept-new pools | PASS: 20/46 new pools took >=20% share in week 1; pooled 24h spread +10.1bp [90% +0.19, +21.2] vs incumbents +9.8bp |
| V-N3 | Sole-LP pool design | Capture depends on depth and fee vs incumbents | 0-RPC capture model | DONE: depth drives flow (Spearman 0.83); rule TRUE via <=5bp (R 2.27, +0.9bp: uneconomic) and >60bp (R 1.95, +246bp, n=6, wash-trade signature) |
| V-N4 | Authenticity audit of >60bp new pools | Wash trading would fake both capture and spread | tx senders, 906 RPC | ACTIONABLE: all 6 organic (58-75 senders/75 swaps, top-3 19-49%, no creator self-trading); median R 1.95, +246bp |
| V-N5 | High-fee venue economics | Persistence + yield on capital net of 3-10% entry | forward Oct (>= 3 weeks) | REGISTERED (needs forward data) |
| V-J | Own-flow recapture | Route vault swaps through our own sleeve pools | analytic | REJECTED: recapture ≈ our L share (~5%) x 30bp ≈ 1.5bp vs paying 30bp instead of the 1-5bp cheapest route (R1). Dominated |
| V-G | Majors at low vol | ETH/USDG volume | backtest | LOW PRIOR |

Per-iteration protocol: read this charter + forward summary -> finish/verdict any running test
(apply the frozen rule exactly) -> else run the top READY item -> commit locally -> report
(what ran, verdict, numbers, next). RPC ≤ 10k/iteration, read-only, never sign/broadcast/push.

* **Loop v2 iteration 2 (cohort wiring):** A25/A26 books added to huntx_forward_shadow.py as 9-day cohorts
  (B0/E1/G1, hash-chained picks, scored after measured ETH entry+exit). Dry run on 09-28 (scratch dir,
  523 RPC) passed; observation only: the B0 yield ranking admits INTC/SNDK/AMD (1.7-2.2% round trip).
  **Next: V-N (does aggregator flow reach new/low-fee pools?) — research measurement only.**

* **Loop v2 iteration 3 (V-N, 0 RPC):** flow is sticky and fee-insensitive; 1% monopoly pools earn 30% of
  fees on 8.8% of volume; new pools capture flow within days (29.5% of 2nd-half volume). Opens V-N2: own
  hookless sole-LP pools as the capacity breakthrough candidate. **Next: pre-register and run V-N2.**

* **Loop v2 iteration 4 (V-N2, 0 RPC): PASS.** New pools win flow and earn ≥ incumbents' spread (thin
  margin: 90% LB +0.19bp). **Next: V-N3 capture model (depth & fee vs incumbents).**

* **Loop v2 iteration 5 (V-N3, 0 RPC):** own pools can beat their depth share (rule TRUE), but the only
  lucrative bucket (>60bp, n=6) looks like wash trading. **Next: V-N4 sender audit (<= 1k RPC).**

* **Loop v2 iteration 6 (V-N4, 906 RPC): ACTIONABLE.** High-fee flow in thin stocks is organic.
  V-N5 registered (needs >= 3 October weeks). **Queue now waits on forward data**: A25/A26 cohorts
  (first verdicts ~10-10), V-N5 (~10-22). Cheap READY items remaining: V-J own-flow recapture (small).

* **Loop v2 paused 2026-09-30 (all READY items done).** Remaining tests are forward-gated:
  A17/A19 frozen book (10+ days -> ~10-11), A25/A26 cohorts (first window closes 10-10), V-N5 (>= 3 Oct
  weeks -> ~10-22), A24 cap change (needs forward confirmation). Re-verify the earnings calendar <= 7 days
  before the 10-10, 10-19 and 10-28 cohorts. Restart the loop when the first cohort window closes.

* **2026-10-01 forward integrity check (0 RPC; no matured outcome).** The cloud
  job succeeded and froze H3/SLP25 October 1 decisions, but skipped A17/A19 and
  A25/A26 stock-book pick files because their functions returned on the first
  decision day. A27 fixes the timing and labels any later October 1 stock pick
  `late_exploratory`; it cannot count as prospective confirmation. Two local
  regression tests pass. Next evidence remains the completed forward exits and
  timely October 10 cohort freeze; no rule or launch gate changed.

* **2026-10-01 A28 (0 RPC; before October 2).** The A17/A19 continuous book
  restarts October 2 with unchanged selection and execution rules, so it can
  produce a timely frozen forward ledger rather than an indefinitely invalid
  October 1 book. The October 1 A25/A26 cohort remains exploratory; no
  completed forward PnL was inspected to select the restart date.
