# HOODX Smart ETH High: the higher risk/reward variant (2026-10-04)

Companion to the locked safe design in `docs/SMART-ETH-LEVERAGE-VAULT-2026-10-04.md`. It uses the same legos (Morpho WETH→USDG 77%, free flash loans,
Uniswap 0.01% pool, steakUSDG, Chainlink ETH/USD and BTC/USD), the same execution (1h delay, ±0.10 band, $100k slices), and the same 10% performance fee.
Scripts: `research/boost/backtest/` (`high.py`, `hv.py`, `h5_validate.py`, `h6_stress.py`).

## Design: two layers

```
slow  = ETH 4-EMA ensemble (20/50/100/200d), averaged 50/50 with BTC's, 1% hysteresis          (0 … 1)
fast  = the same with fast spans (5/10/20/50d)                                                    (0 … 1)
core  = slow                                            the ETH held: 0× (dollars) to 1× (all ETH)
boost = fast × (min(2.0, 2.4 / σ̂) − 1),  only while slow ≥ 0.75                                 leverage on top, when the big trend is on
leverage = min(2.0, core + boost)                       hard cap 2.0× (LTV ≤ 50%; liquidation needs an instant −35% gap)
```

Both vaults fit one contract formula, `min(cap, slow × min(coreCap, coreTv/σ̂) + boost)`. Safe: coreCap 1.75, coreTv 0.8, boost off. High: coreCap 1, coreTv ∞, boost on.

## How it was chosen

| Step | Finding |
|---|---|
| Always ≥1× ETH (floors) | Captures bull upside but keeps ETH's −95% crashes. A 0.5× floor beat a 1× floor on every asset. **No floor beat both** (mean log-growth 0.899 vs 0.836 vs 0.685), so the user's go-ahead to leave ETH when smarter was taken |
| Single-layer leverage vs two layers | Two layers win: a fast booster on top of a slow core |
| Cap / vol target grid | Cap 2.5 liquidated once (BTC test) and was rejected. Cap 2.25 adds a little median growth but worsens tails and thins the liquidation buffer to −28% (the worst real hour was −28.8%). **Cap 2.0, vol target 2.4** chosen |
| Robustness | Vol target 1.6-3.0, fast spans (3/7/14/30 … 10/20/50) and gate 0.5-1.0 all within ±0.06 log-growth |
| Walk-forward | Yearly re-tuning ×403 = fixed design ×403 (2019-26). Not overfit |

## Results (all costs; $250k vault)

| | Safe (locked) | **High** | ETH held |
|---|---|---|---|
| 2016-10 → 2021 | +198%/yr, dd −43% | **+618%/yr, dd −69%** | +192%/yr, dd −94% |
| 2022 → 2026-10 | +33%/yr, dd −49% | +32%/yr, dd −62% | −7%/yr, dd −77% |
| BTC / SOL, same rule | +93% / +49% | +141% / +71% | +56% / −4% |
| 2020 / 2021 | +496% / +211% | **+989% / +771%** | +475% / +400% |
| 2022 / 2023 / 2024 / 2025 | −14 / +72 / +68 / +22% | −16 / +57 / +88 / +35% | −68 / +91 / +45 / −12% |
| 1-year entry: median, worst, chance of a loss, beat ETH | +57%, −44%, 15%, 76% | +83%, −57%, 18%, **90%** | +25%, −91%, 44%, — |
| 2-year entry: worst, chance of a loss, beat ETH | −16%, 2%, 87% | −39%, 4%, **97%** | −88%, 36%, — |
| Monte Carlo 4y median / p10 / p5 | +73% / +12% / −2% | **+141% / +12% / −9%** | +71% / −14% / −30% |
| Monte Carlo: beat ETH, chance of a loss, median drawdown | 48%, 6%, −53% | **88%**, 7%, −75% | —, 15%, — |
| 2019-26 compounded | ×94 | **×403** | ×20 |
| Liquidations (history and 300 Monte Carlo paths) | 0 | 0 | — |

**Capacity:** +34% / +32% / +29% / +20% a year in 2022-26 at $0.05M / $0.25M / $1M / $3M. It trades about 400-600 times a year. Launch cap $1M.

**Stress:** keeper outages of 24-72h at six crash hours caused no liquidations. The weak spot is a sudden crash out of a strong uptrend:
Oct 2025 was −32% (−38% with a 48h outage) against ETH's −28%, and May 2021 was −24% to −29% against −31%.
Chainlink's update rule (0.5% move or 24h) cost 2 points a year in 2022-26.

## Trade-off in one line

The High vault's median outcome is about double the Safe vault's and it beats ETH in bull markets. In exchange, drawdowns of 60-75% are normal along the way, and
a sudden crash from a leveraged uptrend can hit it harder than ETH. The Safe vault keeps drawdowns near 45-50% and the chance of a loss lower.
