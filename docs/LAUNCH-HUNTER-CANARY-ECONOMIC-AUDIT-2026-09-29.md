# Launch Hunter V1 — Economic Audit

Date: 2026-09-29

## What the evidence supports

The research found an edge only after delaying entry and filtering for survivors. Immediate launch entry was rejected. The historical screen used a 24-hour wait, a 1.25x two-hour reference threshold, at least 20 ETH of six-hour volume, at least 48 swaps, at least 12 active 15-minute bars, and one position per creator/funder cluster.

Only four historical cohort selections passed. Their simulated vault-level results were -0.133%, -0.123%, -0.114%, and +2.009%. The arithmetic mean was +0.410% and the median was -0.118%. One winner drove the positive mean. This is a small, skewed sample and **is not a weekly APR or an annualizable return estimate**.

## Canary economics

- Initial capital: 0.073973 ETH, approximately $200 at the research snapshot.
- Initial state: 100% WETH.
- Maximum candidate probe: 0.000369865 ETH, 0.5% of the original seed.
- Maximum simultaneous launch exposure: 0.001849325 ETH, 2.5% of the original seed.
- Maximum active candidates: five, with one per creator/funder cluster.
- Profit rule: after a candidate reaches at least 1.5x, sell enough to recover at least the original WETH probe.
- Remainder rule: exit at a 40% drawdown from observed high water or at 12 hours from entry.
- Absolute risk budgets never grow with donations, mark-to-market gains, or future vault profits.

If all five probes went to zero before an exit, the planned gross asset loss is capped at 2.5% of the original seed. Execution gaps, token taxes, malicious token behavior, and unavailable liquidity can consume the full value of an individual sleeve. They cannot consume the WETH that was never allocated to that sleeve through the vault's trade path.

## Why the vault rotates

The listed coins are candidates, not permanent holdings. The vault remains in WETH until a new token independently passes the admission rules. A qualifying token receives one small probe, then exits under the principal-recovery, trailing, or time rule. A later qualifying launch can replace it. The contract does not hardcode a fixed basket of launch names.

## Promotion requirements

The closed canary is for measuring selection quality, real slippage, taxes, failed exits, and operational cadence. Public deposits and an advertised yield remain blocked until the shadow/live sample is large enough to estimate tail loss and the selection process is reproducible. The current evidence supports a bounded experiment, not an APR claim.
