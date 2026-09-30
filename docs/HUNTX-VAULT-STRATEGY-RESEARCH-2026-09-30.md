# LP vault strategy research: where the edge is on Robinhood Chain (2026-09-30)

Status: **one strong candidate (SLP25, the stock-token narrow LP vault).** It is
positive out of sample with exact costs, but "beats Krystal" is not yet
statistically proven, and the $200 portfolio is underpowered. It is now in the
daily forward test (A14). Nothing is deployed; the HUNTX launch gate is unchanged.
Rules and verdicts: `docs/HUNTX-EDGE-PREREGISTRATION-2026-09-30.md` A10–A14.

## First principles

LP P&L = fees − adverse selection (informed and arbitrage flow) − drift of the
inventory held − management costs (conversions, rebalancing swaps, gas).
Memecoins fail on drift. Majors fail on adverse selection (on-chain vs-hold ≈ 0).
**Tokenized stocks** are different: retail pays a 0.30% pool fee to trade AAPL,
META, NVDA or SPY on-chain, and the informed flow that arbitrages against the
real stock market takes back only part of it.

## Evidence chain

1. **Asset-class map** (1.23M rug-marked LP episodes): stock tokens are the
   steadiest class, with vs-hold +0.3% / +0.1% and win rate 71% / 53% across
   both halves. Majors ≈ 0 vs hold. Memes decay.
2. **Flow toxicity by US session** (108 pools, about $700M of volume,
   `research/huntx_stock_sessions.py`): the LP keeps a positive spread in every
   session at 1 h, 4 h and 24 h. At 24 h: regular +16.5bp, pre-market +10.8,
   overnight +14.5, weekend +24.3, after-hours +41.1. Informed flow concentrates
   in pre-market and regular hours.
3. **Krystal scouting:** their Robinhood automated strategies win in stocks
   (22/27, +$3,373) and majors (10/11) and lose in memes (16/31, −$6,963). Their
   vaults' on-chain stock positions win 64%. High displayed APR anti-predicts PnL.
4. **Vault backtest (A10, exact quotes):** LP vs hold is positive in every
   always-on variant (+$0.21 to +$0.51 per $100 per 5 d), but $0.27/tx
   Krystal-level gas and per-unit conversions sank $100 units.
5. **Gas measured, not assumed (A12, fork):** a lean direct-PoolManager vault
   costs mint $0.017, swap $0.009, burn $0.012 per tx (22× below $0.27).
6. **Management factorial (A11):** 27 configurations (width × reband × session)
   screened on 254 paired first-half units. Pattern: **narrower wins**; swap-to-
   rebalance (Krystal/RAPTOR style) is the worst reband; session gating gives up
   more fee volume than it saves. Selected `±2.5% | static | always`.
7. **Untouched confirmation (09-16..24, exact quotes):**

| | n | Net per $100 per 5 d | 90% day-cluster | vs hold | Win | Profitable symbols |
|---|---|---|---|---|---|---|
| **SLP25** (±2.5%, static) | 277 | **+$0.61** | **+0.27 … +0.92** | +$0.73 | 74% | 18/26 |
| Krystal-like (±10%, swap-rebalance) | 277 | +$0.47 | −0.09 … +1.06 | +$0.60 | 66% | 18/26 |
| Paired difference | 277 | +$0.14 | −0.24 … +0.51 | — | 56% | — |

8. **Fork fee validation, ±2.5% stock positions:** model ÷ actual median 1.000
   (0.95–1.14) over 1,241 replayed swaps.
9. **$200 portfolio (A13):** K=3 −$0.81 (5/6 positions profitable; one NFLX
   unit −$5.36); K=5 +$1.39 (8/10). Underpowered: two rounds only.

## Our angle vs Krystal (what the data supports)

| Lever | Krystal agents | SLP25 | Evidence |
|---|---|---|---|
| Asset class | Mostly memecoins | Tokenized stocks only | Class map; Krystal's own strategy stats |
| Width | ±6–15% | ±2.5% | Factorial: fees roughly 2× vs ±10% |
| Rebanding | Swap back to 50/50 | None (static) or swap-free maker | Swap-rebalance ranked last |
| Execution | Heavy multicalls (~$0.27/tx) | Direct PoolManager (~$0.0125/tx) | Fork gas measurement |
| Valuation | Mid-price marks | Executable quotes | Every verdict |

Honest caveat: in stock pools a Krystal-like manager also profits (+$0.47). Most
of the edge is **choosing the venue**. The management improvement (+$0.14) is not
yet statistically proven.

## Risks and limits

* **Single-name moves** (NFLX −8% on a unit). Mitigation: breadth (K ≥ 5, one per
  symbol); an earnings-calendar exclusion is a candidate rule for a future
  amendment (not tested).
* **Fee decay:** fees fell from $2.73 to $1.49 per $100 per 5 d between halves.
  If more LPs arrive, per-LP fees fall.
* **Stock beta:** the NAV carries stock exposure (vs hold is the alpha; vs USD
  includes the stock move).
* **One month of data;** the lean universe excludes stock pools created later.
* **Implementation:** needs a V4 LP module (see the contract-change request);
  HUNTX V3 cannot hold LP positions.

## Next

* Forward test (daily scheduled task, A14): after ≥ 30 decision days, judge SLP25
  on population and $200 K=5 book criteria.
* Draft the V4 stock-LP module (static ±2.5% ranges, one position per symbol,
  keeper-light since there is no rebanding), fork tests only.
* Future pre-registered variants (not yet tested): earnings-calendar exclusion,
  continuous (non-unit) operation to avoid repeated conversions, after-hours
  width skew.

## Update — continuous vault simulation and contracts (2026-09-30)

**Continuous operation (A15, $200, 09-04 → 09-29, exact entry and exit):**

| Policy | Net | vs holding the same 5 stocks (−$21.12) |
|---|---|---|
| SLP-v2-vol (±2.5–6% by 3-day σ, one-sided maker rebands, daily compounding) | **+$10.73** | +$31.85 |
| Krystal-like continuous (±10%, swap-to-rebalance, harvest) | +$9.74 | +$30.86 |
| SLP-v2 (±2.5%, maker rebands) | +$8.91 | +$30.03 |

The LP vault earned about +5% in 25 days while the underlying stocks fell 10.6%.
Management variants are within about ±$1 of each other: **the edge over
Krystal-style agents is the venue plus lean execution**, not a management trick.
Partly in-sample (width and reband style were chosen on 09-08..15).

**Contracts (branch `research/stock-lp-vault`, fork-tested, not deployed):**
* `contracts/liquidity/v4/HoodxLiquiditySleeveV4.sol`: one V4 range position
  held directly in the PoolManager (lean gas measured at $0.0125/tx). Fungible
  shares, controller-only management, no swaps, and an always-available
  pro-rata redeem in kind, even while paused.
* `contracts/liquidity/v4/HoodxStockLpControllerV1.sol`: V1-controller
  governance (curator-only moves, permissionless breach signal, dwell and
  cooldown) plus (a) a pool-spot vs **independent price reference** guard,
  since V4 unhooked pools have no TWAP, and (b) one-sided maker rebands, with
  edge-crossing no-ops refused.
* Reuses `HoodxLiquidityIndexV1` unchanged with USDG as the quote asset
  (unwrap in kind; no oracle needed to exit).
* `test/liquidity/StockLpV4Fork.t.sol`: 5/5 pass on a Robinhood fork (META
  and SPY pools, both token orders). Lifecycle, fees, harvest, compound, exit
  while paused, maker reband after a 24 h keeper-attested breach, no-op refusal,
  reference-divergence blocking, and access control. Moving these pools about
  4% took $1.3–1.7M of flow (deep exits).

**Still required before any launch decision:** a production price reference
(compose HOODX CL TWAPs over each stock's V3 pools with WETH/USDG), launcher and
bootstrap script, an independent security review, and the A14 forward-test verdict.
