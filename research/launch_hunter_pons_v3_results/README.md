# PONS V3 fee-machine evidence

This directory contains compact outputs from three rolling, out-of-sample weekly evaluations of legacy PONS v1 Uniswap v3 pools.

- `pons_v3_persistent_basket_weekly.csv` contains the corrected DELTA/PONGO/GIWA position returns and the 25%-reserve vault result.
- `pons_v3_fee_validation.csv` reconciles event-derived fee accrual with historical Uniswap fee-growth state.
- Each fold contains the full compact position outcomes and strategy summaries.
- `pons_v3_manifest.json` records the frozen screening assumptions and position cost model.

Raw swap logs, factory logs and the private archive endpoint are intentionally excluded from version control. The study is read-only and does not authorize a deployment or transaction.
