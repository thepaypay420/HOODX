# Launch Hunter V1 — Production Runbook

## Stage A — immutable infrastructure

1. Refresh `launch-hunter-launch-preflight.json`; proceed only when it says `READY_TO_DEPLOY`.
2. Run `scripts/run_launch_hunter_deployer.ps1` in a visible PowerShell window.
3. Unlock only the local Foundry account `hoodx-deployer-v2` and inspect the single deployment transaction.
4. Record the receipt and run `scripts/verify_launch_hunter_deployment.mjs <launcher>`.
5. Confirm the policy owner and vault curator are exactly `0x134D468B0bcaeA6DF127916f951F7938c06A37C6`, the vault is unbootstrapped, and the image/seed/share constants match the audited build.

## Stage B — closed canary funding

1. Fund the official curator with enough for 0.073973 ETH plus gas. At the 2026-09-29 preflight it was short by 0.049711432432607203 ETH before a safety margin; target at least 0.052 ETH additional funding.
2. Start `scripts/launch_hunter_bootstrap_wallet.mjs <launcher>` and open `http://127.0.0.1:8798` in Brave.
3. Connect Rabby with the official curator on Robinhood Chain.
4. Sign the one exact bootstrap transaction. It buys no launch token.
5. Verify 200 HUNTX in the curator wallet and exactly 0.073973 WETH in the vault.

## Stage C — candidate-by-candidate admission

Do not arm or buy a candidate until all are recorded: canonical token address, PONS family proof, creator/funder cluster, 24-hour age, price/reference ratio, six-hour volume, swap count, active-bar count, transfer-tax behavior, immutable/runtime code review, oracle sanity, exact buy/sell route, and current-fork round trip. Store the evidence hash in the arm transaction. Wait the on-chain 24-hour observation period, repeat the checks, then enter at no more than 0.5% of original seed.

Never reuse a symbol or image as identity. Never replace a failed route with an unreviewed token address. Never advertise APR from the four-event research sample.
