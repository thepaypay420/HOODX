# Boosted ETH: economics (2026-10-04)

How money moves through the vault: what users pay, what the strategy costs, what HOODX earns and what it costs to run.
Strategy research: `docs/SMART-ETH-HIGH-VARIANT-2026-10-04.md`. Security: `deployments/BOOST-ETH-VAULT-SECURITY-REVIEW.md`.
Model: `research/boost/` (hourly 2016-26; figures below are 2022-26, the period never used to choose parameters, at a
$250k vault with every cost included unless stated).

## 1. Fees

| Fee | Level | Who receives it | Notes |
|---|---|---|---|
| Deposit / withdrawal fee | **none** | — | Each user pays only their own entry or exit swap (below) |
| Management fee | **none** | — | |
| Performance fee | **10%** of gains above a high-water mark | HOODX treasury `0x134D…37C6` | Crystallised at most every 30 days as newly minted shares; no fee until NAV per share beats its previous peak |

## 2. What a user pays

| Item | Typical cost |
|---|---|
| Gas to deposit / withdraw | ≈ 290-580k gas: about 2-3 cents at 0.02 gwei |
| Entry swap (only the part of the deposit that becomes borrowed ETH or dollars) | 1.4 bp at $10k, 4 bp at $100k (live quotes, 0.01% pool) |
| Exit swap | Same scale; bounded by the user's own `minEthOut` |
| Dilution from other users | Zero by construction (deposits mint on NAV actually added; tested) |

## 3. What the strategy costs, inside NAV (2022-26, $250k vault)

| Driver | Effect on annual return |
|---|---|
| Trading costs (about 440 rebalances a year at 1 bp fee + measured impact) | −2.6 pts |
| Borrow interest (5% assumed; the Morpho market charges ~0.05% today) | −1.7 pts (−3.3 at 10%) |
| Dollar yield while out of ETH (steakUSDG at 4% assumed) | +2.4 pts (+4.3 at today's 7.1%) |
| Performance fee | −4.2 pts |
| **Net** | **+32.4%/yr** (ETH held: −7%/yr) |

Average exposure is 0.79x ETH: the vault is boosted in strong, calm uptrends, plain or partly in dollars in mixed markets,
and fully in dollars in downtrends.

## 4. What to expect

| | Boosted ETH | ETH held |
|---|---|---|
| 2022-26 (test) | +32%/yr, worst drawdown −62% | −7%/yr, −77% |
| 2016-21 | +618%/yr, −69% | +192%/yr, −94% |
| Monte Carlo 4-year median / 10th percentile | +141% / +12% a year | +71% / −14% |
| Chance of losing money over 4 years | 7% | 15% |
| 1-year entries that beat ETH | 90% | — |

These are backtests. Drawdowns of 60-75% are normal along the way; the vault lags straight-up rallies (2023: +57% vs +91%)
and earns its keep by stepping aside in crashes.

## 5. Capacity

| Vault size | 2022-26 return | Binding constraint |
|---|---|---|
| $50k | +34%/yr | — |
| $250k | +32%/yr | — |
| $1M | +29%/yr | Pool impact (sliced at $100k/h) |
| $3M | +20%/yr | Pool impact |

Borrowing: the Morpho market has ~$45k of free USDG today, enough for about $45-90k of vault at full boost. Beyond that the
vault simply runs less boosted (tested: deposits and exits keep working with zero borrowable liquidity) until the adaptive
rate draws more lenders; even a 100% borrow rate above $45k of debt leaves about +20%/yr. Cap at launch: **$1M** (immutable).

## 6. HOODX revenue and running cost

Running cost (measured gas at 0.021 gwei, ETH $2,690):

| Action | Gas | Per call | Per year |
|---|---|---|---|
| `poke()` (hourly) | ~136k | ~$0.008 | ~$67 |
| `rebalance()` (~440/yr) | ~580k | ~$0.03 | ~$15 |
| `crystalliseFees()` (monthly) | <200k | <$0.01 | <$1 |
| **Keeper total** | | | **≈ $85/yr** (plus any L1 data surcharge) |

Performance-fee revenue at the 2022-26 return (fees only accrue on gains above the high-water mark, so bad years pay nothing):

| TVL | Expected gain/yr | HOODX fee/yr | Fee − keeper |
|---|---|---|---|
| $200 (seed) | $65 | $6.50 | −$78 |
| $10k | $3.2k | $320 | +$235 |
| $100k | $32k | $3.2k | +$3.1k |
| $1M | $290k | $29k | +$29k |

Break-even is roughly $3k of TVL. At the $200 seed the keeper costs more than the fee earns; the keeper wallet is the
existing gas-only AutoLP keeper, so this is a small fixed cost until deposits arrive.

## 7. Parameters (immutable at deployment)

Vault: cap $1M · min deposit 0.005 ETH · slice $100k · interval 55 min · band ±0.10x · swap bound 0.5% (3% in emergencies) ·
oracle agreement 1% · hard cap 2.05x · LTV ceiling 56.25% · dead-man 24h · fee 10% / 30 days.
Signal: cap 2x · vol target 240% · gate 0.75 · hysteresis 1% · EMAs 20/50/100/200d (core) and 5/10/20/50d (booster) ·
14-day volatility half-life · feeds stale after 25h.
