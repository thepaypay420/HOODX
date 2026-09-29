# HUNTX V3 closed-pilot launch

This launch is deliberately split into two independently verified layers. No step buys a launch token and public deposits remain unavailable.

1. Run `python scripts/prepare_huntx_v3_base.py`. Continue only when the manifest says `READY_TO_DEPLOY_AND_BOOTSTRAP` and is under 15 minutes old.
2. Run `scripts/run_huntx_v3_base_deployer.ps1` with the local deployer keystore. This 0-ETH transaction deploys FEEX, its controller, and four LP sleeves.
3. Run `python scripts/verify_huntx_v3_base.py <deployment-tx-hash>`. The verifier derives the launcher from the exact reviewed transaction; do not fund an unverified address.
4. Run `python scripts/run_huntx_v3_base_wallet.py`, connect only the official curator, and fund the exact $160-equivalent FEEX seed.
5. Run `python scripts/prepare_huntx_v3_launch.py`. Continue only on `READY_TO_DEPLOY` with a fresh manifest.
6. Run `scripts/run_huntx_v3_deployer.ps1` with the local deployer keystore. This 0-ETH transaction deploys the append-only policy and closed HUNTX vault.
7. Run `python scripts/verify_huntx_v3_deployment.py <deployment-tx-hash>`. It pins transaction provenance, authority, bytecode-dependent terms, 80/20 funding, and exit constants.
8. Run `python scripts/run_huntx_v3_wallet.py`. The official curator signs exactly two transactions: approve 160 FEEX, then atomically transfer FEEX plus the WETH working sleeve and mint 200 HUNTX.
9. Confirm `deployments/huntx-v3-live.json` says `LIVE_CLOSED_PILOT` before any candidate is considered.

Candidate admission remains a later, separate process: approve a reviewed route, arm it with evidence, wait 12 hours, then enter one fixed 10% probe. At most two probes may enter per day, at most two may be active, and each has a public +50% / -20% / four-hour exit trigger protected by an independent 97% oracle floor.

Never retry a failed transaction without refreshing its preflight and inspecting the first receipt. Never weaken minimums or substitute addresses to make a step pass.
