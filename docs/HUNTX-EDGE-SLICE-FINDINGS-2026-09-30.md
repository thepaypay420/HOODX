# HUNTX LP edge — pilot-slice findings (2026-09-30)

Status: **one pre-registered candidate (H3), not launch-ready. HUNTX V3 economic launch gate remains BLOCKED.** See §7 for the out-of-sample test that supersedes the slice-only H3 figures below.
This is an exploratory, cost-bounded slice (Amendment A2): 5 decision days,
2026-09-23..09-27, inside fold F3, which is partially contaminated. The rules
are frozen in `docs/HUNTX-EDGE-PREREGISTRATION-2026-09-30.md` (hash chain in
`research/huntx_edge_prereg.sha256`). No threshold was tuned on outcomes.

## 1. What was fixed before any result was trusted

| Issue | Evidence | Effect |
|---|---|---|
| The old replay charged fees on the V4 **output** amount and applied an arbitrary 70% haircut | `huntx_edge_fee_validation.py`: event vs on-chain `feeGrowthGlobal` ratio 0.94–1.05 with the negative-amount convention, 0.09–10.5 with the old one | All earlier `krystal_multi_pool_lp_replay` rankings are void |
| H5 fill detection compared 18-dec token and 6-dec USDG raw units, dropping unfilled USDG | Hand trace of one pool: −$89.7 phantom vs −$7.2 correct | Fixed (price-crossing detection, residuals carried); rerun |
| First-day boundary price missing (logs start at the boundary) | 2026-09-23 had 0 gate-passes | Fixed with the exact archive slot0; rerun |
| Rate-limit errors could be misread as failed quotes | Engine now retries transport errors and treats only reverts as failures | Fixed before scoring |
| H6 markout horizon crossed the decision block | Capped at the window end | Fixed before scoring |

Vectorized vs loop fee accrual agree to 15 significant digits. The V4Quoter
returns partial fills rather than reverting on oversized inputs. Partial exit
fills therefore **understate** proceeds, which is conservative.

## 2. Universe and panel (no survivorship selection)

* 932,216 V4 pools registered (all `Initialize` logs since block 9,070).
* 50,514 had USDG/WETH/ETH-quoted swaps in a 5.6% sampled screen (258 windows).
* 5,232 met the pre-registered $5k/day rule; 3,613 met the lean $20k/day rule.
  Of those, 2,142 hooked pools were rejected (G2 UNVERIFIED) and 1,471 unhooked
  pools went to the state panel (31,418 archive reads).
* 796 pools passed the conservative fee-bound prefilter. Their complete Swap logs
  were fetched: 4,439,164 swaps, 1,072 chunks, no failures.

Gate census on a typical day (2026-09-25; one pool can fail several gates):
255 passed every gate; failures were G6 (<20 swaps/day) 303, G7 (one swap > 25% of
volume) 131, G3 (fee accounting mismatch, UNVERIFIED) 107, G5 (round trip too
costly) 95, G1 (age) 70, missing history 70, G4 (quote failed) 8.

Every candidate, gate result and rejection reason for every decision day is in
`research/huntx_edge_slice_ledger.json.gz`.

## 3. Results (exact V4Quoter entry and exit quotes at archive blocks, p90 gas, 3-day hold, $100 unit)

| Hyp. | Candidate-days | Tokens | Mean net / $100 | Median | LP vs hold | Positive days | Verdict |
|---|---|---|---|---|---|---|---|
| H1 persistent fee flow | 346 | 104 | −6.89 | −0.85 | +1.60 | 0 / 5 | **Falsified** in slice |
| H2 flow/liquidity spike | 20 | 16 | −14.70 | −2.44 | −1.64 | 0 / 2 | **Falsified** in slice |
| H3 conditioned USDG bid | 31 | 16 | +0.65 *(was +4.32 before the bid-range fix, §7)* | −0.04 | n/a | 1 / 1 | See §7 |
| H5 maker-only range orders | 484 | 134 | −6.37 | −1.49 | n/a | 0 / 5 | **Falsified** in slice |
| H6 low-toxicity markouts | 291 | 92 | −7.97 | −0.82 | +1.75 | 0 / 5 | **Falsified** in slice |
| C0 naive fee rank (control) | 25 | 14 | −12.94 | −2.69 | −0.37 | 0 / 5 | Fails (expected) |

H1 by stratum: major pairs n=19, +0.13 net / +0.45 vs hold (flat); established
tokens n=275, −6.36; young tokens n=52, −12.24.

$200 top-K portfolios (token/initializer non-overlap, abstain when empty): every
H1, H2, H5, H6 and C0 policy lost money (−$35 to −$178 on $200).
H3 K=3 was +$20 on one decision day; K=1 and K=2 lost.

## 4. Mechanism findings

1. **Fee capture is real; token drift destroys it.** Across H1 candidates the mean
   fee was $9.63 per $100 over 3 days, and the LP beat holding the same tokens in
   67% of cases (+$1.60). Holding the post-entry token mix lost $8.49 on average,
   and 79% of candidate tokens fell over the hold (median −7.7%). The loss
   comes from directional exposure, not adverse fee capture.
2. **Trailing LP performance is anti-predictive.** The 50 highest-scored H1
   candidates averaged −$18.79 per $100; the 50 lowest averaged −$0.69. High
   trailing excess marks tokens that just pumped. Ranking by it (H1, H6, top-K)
   selects the next dumps.
3. **Maker-only execution does not rescue it.** H5 bids did not fill mainly ahead
   of declines (median 24 h post-fill token return −0.8%). The losses are the
   same 3-day drift plus reposition gas in choppy pools.
4. **Exit capacity can vanish.** One pool's active liquidity went from 1.06e22 to
   0 before exit. The mid price was stale and the executable quote was near zero.
   Mid-price valuation would have hidden a 50% loss.
5. **The only positive branch limits inventory.** H3 holds USDG until flow is
   two-way balanced and the 7-day trend is not negative, then only buys dips.
   One day (16 tokens, 9 profitable, token-level median +$2.46, +$1.84 without
   the top two) is one regime and cannot support a policy.

## 5. What would change the conclusion

* H3 with a positive day-clustered lower bound on **untouched** folds F1/F2
  (decisions 2026-09-08..09-21), across ≥ 3 profitable tokens and ≥ 2 folds,
  with the same frozen thresholds. Cost to test: roughly 45–50k RPC requests
  (state panel 09-05..09-19 for the 1,471 lean pools, then logs and quotes).
* A 30-decision prospective shadow of H3 (the frozen 2026-09-30 decisions are in
  `research/huntx_edge_prospective_2026-09-30.json`, with their sha256).
* Fork execution tests of any selected token (transfer tax, reverting or
  gas-heavy tokens, direct PositionManager recovery). Not yet run: no local
  Foundry/anvil binary was found on this machine.

## 6. Reproduce

```
python research/huntx_edge_registry.py 76069815
python research/huntx_edge_activity_screen.py
HUNTX_USD_FLOOR=20000 HUNTX_ETH_FLOOR=6 HUNTX_FIRST_DAY=2026-09-20 python research/huntx_edge_state_panel.py
python research/huntx_edge_prefilter.py
HUNTX_FIRST_DAY=2026-09-20 python research/huntx_edge_log_stage.py
python research/huntx_edge_slice_study.py
```

Archive reads are cached in `research/huntx_edge_rpc_cache.json.gz`. The RPC
endpoint is read from a local file and never printed.

## 7. Out-of-sample test on untouched folds (Amendment A3)

Universe: all 1,471 lean unhooked pools, no fee-bound prefilter. Data:
17.7M early-window swaps (09-01..19) plus 135k gap swaps plus the slice logs,
no failed chunks. 22,054 state reads. 14 decision days (09-08..21) and 1,342
scored outcomes. The rules were frozen before any F1/F2 outcome was computed.

**A defect found during audit.** The H3 bid range was snapped *outward* to tick
spacing. In wide-spacing pools, 94 of 278 bids straddled the price and were
credited with tokens they never bought. Those bids averaged +$18.32; clean
bids averaged +$1.23. The first-pass H3 figure of +$7.01 was therefore wrong.
The fix snaps the near edge inward, which is the pre-registered USDG-only
definition, and an assertion enforces it. Both windows were rescored. No
threshold changed.

| H3 (corrected) | n | Tokens | Mean net / $100 / 3 d | Median | Day-clustered 90% |
|---|---|---|---|---|---|
| F1 09-08..14 | 152 | — | **+3.41** | +0.30 | +0.72 … +6.38 |
| F2 09-15..21 | 126 | — | **+4.00** | +0.04 | +2.53 … +5.40 |
| F3 09-27 (slice) | 31 | 16 | +0.65 | −0.04 | one day |
| Pooled | 309 | 90+ | **+3.38** | — | **+1.90 … +5.06** |

* It passes every frozen A3 criterion. It is positive on 12 of 14 out-of-sample
  days, and 55 tokens have profitable positions (47 of 90 tokens are
  profitable on average).
* **Mechanism:** fees averaged $14.02 per $100 (median $8.20), against an
  inventory-plus-gas loss of $10.34. The profit is fee capture, not a rising
  market: over the holds the median token return was −2.2%, and only 42% of
  tokens rose.
* **Model risk checked:** our liquidity is a median 1.4% of active liquidity in
  the band (p90 about 10%). Bids with under 2% share (n=171) still average
  +$2.45, so thin-pool dominance does not explain the result.
* **Concentration and tails:** without the top 5 tokens the total falls from
  +$1,023 to +$217 (about +$0.9 per $100). 25 of 309 positions lost more
  than $20; the worst lost $78.73; tokens that fell more than 30% cost
  −$22.36 on average.
* **$200 portfolios (K = 1/2/3, 3-day holds, non-overlap):** +$175 / +$72 /
  +$109 on F1+F2 from 5 / 10 / 15 positions (2 / 4 / 7 profitable), and
  −$16 / −$49 / −$6 on the one-day F3 slice. These are very few independent
  positions and dominated by single winners, so they are **not** a return
  forecast and must not be annualized.
* **H1 on the same folds:** F1 +$1.16, F2 +$4.78, but F3 −$6.89. 87% of its
  total comes from 5 tokens and its token-level mean is −$2.61, so it is
  fragile. **C0 control:** F1 −$10.21, F2 −$1.99 (fails, as expected).

**Remaining unverified items (why the gate stays blocked):**
1. Position-exact fees. The model is calibrated to on-chain global fee growth
   but attributes fees within a swap by log-price path. Needs a fork replay.
2. No forward (prospective) decisions scored yet. The 2026-09-30 decisions are
   frozen in `research/huntx_edge_prospective_2026-09-30.json` (8 H3
   selections, sha256 in `research/huntx_edge_results.sha256`).
3. Token behaviour (tax, reverts) and exits on a fork.
4. Survivorship residue: panel membership used the whole window's sampled
   activity (averaged per *active* day, so pools that died early stay in).
5. Contract support does not exist. See
   `docs/HUNTX-EDGE-CONTRACT-CHANGE-REQUEST-2026-09-30.md`.
