# HOODX Fee Machine economic audit

Date: 2026-09-29
Pilot capital: approximately $200
Structure: 30% DELTA/WETH, 30% PONGO/WETH, 30% GIWA/WETH, 10% WETH/USDG

## Economic design

The pilot is fully deployed. There is no idle ETH reserve. The final 10% is a narrow WETH/USDG core LP rather than idle WETH, preserving a liquid major-pair sleeve while letting all seed capital earn fees.

The three 1% PONS V3 pools are the return engine. Each receives 30% of NAV in a centered range approximately 10% wide on either side. The 0.01% WETH/USDG pool receives 10% in a wider approximately 22% range. The bootstrap performs every swap and mint atomically; any failed minimum or pool check reverts the entire operation.

## Historical evidence at pilot scale

The PONS legs were replayed at `0.0222 WETH` per sleeve with a `0.000025 WETH` action cost. The core lower bound used `0.0074 WETH`, charged entry/exit and two actions, and deliberately credited zero fee income.

| Evaluation week | DELTA | PONGO | GIWA | Core lower bound | Combined 30/30/30/10 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-09-07 | +2.57% | -1.71% | +1.12% | +0.04% | +0.60% |
| 2026-09-14 | +17.42% | +6.56% | +14.00% | -4.36% | +10.96% |
| 2026-09-21 | +6.07% | +34.06% | +3.64% | -1.53% | +12.98% |

The combined arithmetic mean was **8.18% per week** and the geometric mean was **8.04% per week**. A simple arithmetic annualization is approximately **425% APR**. These are three historical observations, not a forecast, target, or public yield claim. Compounding them into an APY would overstate the evidence and is intentionally omitted.

## Management cadence

- Observe continuously, but do not move a position because of one trade or one block.
- Require the one-hour PONS TWAP to remain at the range edge for 24 hours.
- Permit at most one PONS re-band every seven days.
- Do not recenter a PONS sleeve downward into a falling paired token.
- Collect or compound only when claimable fees exceed action cost by a meaningful margin. The economic research uses at least five times action cost and 0.5% of total vault NAV as the collection threshold.
- Review membership weekly. Two consecutive complete-week gate failures remove a candidate from the next version; V1 cannot silently replace a pool.

This cadence is intentionally slower than an AI-managed launch sniping system. The measured edge came from persistent routing flow in established PONS V1 pools, not from chasing every new token or repeatedly realizing inventory loss.

## Concentration and loss budget

- Each PONS sleeve starts at 30% NAV. A complete failure of one paired token can impair approximately 30% of seed NAV before residual WETH and fees.
- Simultaneous failure of all three can impair approximately 90%.
- The WETH/USDG sleeve carries WETH price exposure, USDG contract/depeg risk, LP fee income, and range inventory risk.
- Narrow ranges amplify fee share and inventory conversion. Downside no-chase policy limits repeated averaging but cannot prevent loss inside the original range.
- There is no leverage, borrowing, liquidation engine, reward-token dependency, or promised yield.

## Promotion gates

The pilot remains closed for at least four complete weeks. Public promotion requires:

1. realized fees reconciled to position-manager collections;
2. realized gas, slippage, inactive-range time, and inventory P/L recorded separately;
3. every direct recovery rehearsal passing on a fresh fork;
4. no pool identity, fee tier, fee protocol, or token-behavior drift;
5. positive net performance after all costs with enough observations to avoid relying on one exceptional week;
6. a separate audit and product decision for any public deposit path.

## Launch-state gates

The preflight computes an approximately $200 ETH seed from the exact WETH/USDG spot price, rounds down to one-millionth ETH, and locks that amount in the launcher. It also pins current TWAP-centered ranges and refuses deployment while any reviewed pool exceeds its divergence bound.

At the latest 2026-09-29 live check, GIWA was 1,386 ticks away from its one-hour TWAP, above the fixed 500-tick limit. The deployment is therefore correctly blocked until the pool stabilizes. An earlier check also caught PONGO outside the same limit. This is market protection working as designed, not a technical failure.
