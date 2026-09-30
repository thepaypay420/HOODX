# Who actually makes money LPing on Robinhood Chain? (2026-09-30)

Status: **research finding, not a launch approval. HUNTX launch gate stays BLOCKED.**
Frozen tests: amendment A4 in `docs/HUNTX-EDGE-PREREGISTRATION-2026-09-30.md`.

## Data (read-only, the whole population, not a leaderboard)

* Every V4 `ModifyLiquidity` (3,577,331) on the 1,471 lean pools and every
  PositionManager NFT transfer (3,358,029), 2026-09-01..09-29, about 9.3k
  requests (`research/huntx_lp_population_fetch.py`).
* 1,309,702 reconstructed LP episodes across 21,856 owners
  (`research/huntx_lp_population_build.py`). Fees use the validated V4 model
  with each position's own share of active liquidity; values are at pool mid.
* All 250 Krystal Robinhood vaults from Krystal's public API
  (`research/huntx_krystal_rh_vaults_snapshot.json`), plus the published
  RAPTOR-X agent playbook (`research/huntx_krystal_raptorx_instructions.json`).
* 2,000 randomly sampled Krystal vault transaction receipts for real gas and
  swap costs (`research/huntx_krystal_swap_costs.py`).

## Data-quality decisions (all outcome-blind and applied to every owner)

* 2.09M NFT mints in the month, 57,089 minters. The top bots mint and burn
  about every 20 s.
* 555 pools hit the V4 tick bound with a price span ≥ 1e12. These are drained or
  manipulated, and mid-price valuation there produced returns of 1e36.
  **Final rule:** each episode is judged by the pool price at its own events. An
  episode opened at a degenerate price is dropped (982). An episode still open
  when its pool became degenerate is marked as a **total loss of remaining
  value** (905). Deposits must be between $5 and $1M. Weighted returns are
  capped at [−100%, +1000%].
* Pre-window liquidity and events outside swap coverage are dropped (4,118).

## Results

**Krystal's own list (displayed, mid-marked):** 250 vaults, $2.43M of
cumulative deposits, $139.7k of fees, only **+$20.3k net**. The median vault is
at −0.1%; 120 are up and 129 are down. Displayed numbers are internally
inconsistent (the same vault shows $2,913 vs $3,689 PnL on two endpoints).

**On-chain population (1.23M valued episodes):** about +1–2% per episode vs
hold, decaying from the first half to the second. Most fee income goes to
inventory loss.

| A4 test | Result | Verdict |
|---|---|---|
| 2. Owner skill persists | Spearman 0.26–0.27 (2,093 owners). First-half top decile: +2.5–2.8% vs hold in the second half vs +0.45–0.47% for the population | **PASS**. Real but heavily regressed skill |
| 3. Best first-half entry feature holds | ≥3% fee tier +0.71% in the second half, but the winner depends on the data-quality rule (under the 1000× rule, ETH-quoted pools won first and then failed at −0.30%) | **FRAGILE**, not a pass |
| 4. Krystal vault contracts beat the population vs hold in both halves and are > 0 vs USD in the second half | First half +2.55% vs +2.28%; second half **+2.27% vs +0.59%**, +1.43% vs USD | **PASS** |

**Mechanism:** Krystal agents capture **7–9% of deposits in fees per episode vs
1.5–4.2%** for everyone else. They are not better at avoiding inventory loss;
they select high fee-per-liquidity pools, re-range at most daily, and sweep fees
out to ETH.

**After costs:** September Krystal on-chain episodes made +$14.3k vs USD
(+$22.3k vs hold) on $73.6k of fees. Measured execution cost was about $10.6k:
gas $0.27/tx and swaps $0.19/tx over 20,427 txs, with 25% of swaps unpriced
and scaled up. The net is **about +$3.7k on roughly $42–55k of deployed capital
in one month**.

## What this does and does not show

* It is the first positive, on-chain, both-halves result in this research: a
  **breadth fee-harvesting** operator style earns more than it loses after
  measured costs.
* It is **one month**, and the vaults are **correlated** (many are copies of the
  same RAPTOR-X playbook). Open positions are marked at mid with no exit
  quote. 25% of swap costs are extrapolated. The margin after costs
  (about +$3.7k) is small relative to the uncertainty.
* It does **not** show that the HUNTX pilot can replicate it. The pilot would
  need a V4 LP module, keeper automation and daily re-ranging; see
  `docs/HUNTX-EDGE-CONTRACT-CHANGE-REQUEST-2026-09-30.md`.

## Causal clone of the harvester (A5) — FALSIFIED

RAPTOR-X's published entry filters were applied causally on 2026-09-15..24:
centered ±15%, daily re-centering after a full out-of-range day, daily fee
sweeps, exact V4Quoter costs, 5-day units (`research/huntx_harvester_clone.py`).

| | Result |
|---|---|
| Units / tokens | 1,695 / 185 (85 profitable tokens) |
| Mean net per $100 at executable exit | **−$2.08** (90% day-cluster −5.77 … +1.46) |
| Same units marked at mid (Krystal convention) | +$1.14 |
| Mean fees per $100 | $23.41 |
| $200 portfolios K=1/2/3 | −$97 / −$98 / −$89 |

By fee/TVL quintile, fees per $100 rise $9 → $40 while the median token
return falls −3% → −25% over 5 days.

**Interpretation.** The Krystal vaults' on-chain "edge" is largely an artifact
of never exiting and marking inventory at mid. At executable prices, and
applied causally, the published formula loses. High fee/TVL is mostly
compensation for being on the wrong side of tokens that are being sold down.
**The "profitable users" formula does not survive as a HUNTX strategy.**
The only mechanism in this research that avoided the drift trap remains the
conditioned USDG bid (H3), which still needs a forward test.
