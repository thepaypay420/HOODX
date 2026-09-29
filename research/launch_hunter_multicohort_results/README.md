# Launch Hunter multicohort evidence

This directory contains the compact, reviewable outputs for the September 2026 Launch Hunter study. The scripts rebuild the excluded large bar and per-policy outcome files when `LAUNCH_HUNTER_RPC_URL` is set to an archive-capable Robinhood Chain endpoint.

## Reproducible scope

- Four independent six-hour launch cohorts: 13, 15, 17, and 20 September 2026 UTC.
- 6,339 initialized ETH/WETH Uniswap v4 pools screened.
- 113 pools passed the first market-activity gate.
- 65 pools passed the stricter flow gate.
- Five pools were canonical Doppler launches with enough activity for the relaxed LP test.
- Seven-day paths use 15-minute bars derived from on-chain swap logs.

## Result files

- `cohort_summary.csv`: denominators and gate counts by cohort.
- `multicohort_screen.csv`: per-pool screening, provenance, fee, sender, and markout fields.
- `candidate_7d_paths.csv`: compact seven-day path outcomes for the 113 screened candidates.
- `runner_policy_summary.csv` and `staged_runner_summary.csv`: conventional and staged directional policy sweeps.
- `survivor_policy_summary.csv`: delayed survivor threshold sweep.
- `survivor_clustered_summary.csv` and `survivor_clustered_daily.csv`: creator-cluster-capped portfolio results.
- `doppler_*`: canonical fee-bearing Doppler LP simulations and summaries.
- `manifest.json` and `longitudinal_manifest.json`: run parameters and counts.

## Decision boundary

No tested fee-bearing launch LP strategy demonstrated a reliable positive edge after execution and management costs. The delayed survivor construction reduced loss severity and produced a positive average only because one of four selected names became a large winner. It remains a shadow strategy: it is not evidence for accepting public capital.

The private RPC URL and cached raw observations are intentionally excluded from version control.
