# Boosted ETH research

| File | What it does |
|---|---|
| `boost_signal_ref.py` | Integer-exact Python port of `HoodxBoostSignalV1` (same fixed-point steps and rounding) |
| `boost_seed.py` | Rebuilds the signal state from public Coinbase hourly closes and writes `deployments/boost-eth-seed.json` (run right before deploying) |
| `gen_vectors.py` | Writes `test/boost/BoostVectors.sol`: a seed plus 60 reference pokes the Foundry tests must match exactly |
| `backtest/` | The strategy research: `sim2.py` (vault simulator: delayed execution, keeper gaps, measured pool impact, sliced trades, borrow limits, fees, liquidation at 77% LLTV), `hv.py` (the boosted signal), `equiv.py` (the on-chain formula reproduces the backtest), `h5_validate.py` (cohorts, Monte Carlo), `h6_stress.py` (capacity, keeper outages, Chainlink gating, walk-forward), `t2_cross.py` (BTC/SOL), `t4_surface.py` (parameter surface) |

Data: `python backtest/fetch_any.py ETH` (and `BTC`, `SOL`) downloads Coinbase hourly candles into `backtest/`.
Docs: `docs/SMART-ETH-LEVERAGE-VAULT-2026-10-04.md` (pass 1-2), `docs/SMART-ETH-HIGH-VARIANT-2026-10-04.md` (the boosted design),
`docs/BOOST-ETH-ECONOMICS-2026-10-04.md`.
