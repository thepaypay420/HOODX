# Boosted ETH launch runbook

Everything below is done by the curator/deployer; nothing is signed by automation. Keystore passwords are entered only in
Foundry's own prompt. Never paste the private RPC URL anywhere public.

## 0. Before launch (once)

1. Review: `deployments/BOOST-ETH-VAULT-SECURITY-REVIEW.md`, `docs/BOOST-ETH-ECONOMICS-2026-10-04.md`.
2. Run the suite on the exact build to deploy:
   `FOUNDRY_PROFILE=boost forge test` (fork of Robinhood Chain; set `ROBINHOOD_RPC_URL` for a private endpoint). All 47 must pass.
3. Commit the build. In `deployments/boost-eth-v1-manifest.json` set `"status": "APPROVED"` and `"reviewedBuild"` to that
   commit hash.
4. Fund the deployer `0xf63E63a80A25611154C5d1c06E55FD763E0cfC19` with the seed (0.075 ETH, about $200) plus ~0.003 ETH gas.
5. Make sure the keeper wallet (the AutoLP keeper, secret `AUTOLP_KEEPER_PRIVATE_KEY`) holds ≥ 0.01 ETH for gas.

## 1. Deploy (about 2 minutes)

```
powershell -ExecutionPolicy Bypass -File scripts/run_boost_eth_deployer.ps1
```

The runner regenerates the signal seed from public price history (the signal rejects a seed more than 3% from the live
Chainlink feeds), checks the manifest, then broadcasts four deployer transactions: the signal, the vault, `bootstrap` with
the seed (shares to the treasury, dead shares locked) and `transferOwnership(treasury)`. It prints both addresses and the
signal's current target.

## 2. Hand over and verify (treasury wallet)

1. From the treasury `0x134D…37C6`, call `acceptOwnership()` on the vault (Rabby).
2. Verify both contracts on the explorer (Blockscout) with the exact build.
3. Check on-chain: `vault.owner()` = treasury, `vault.bootstrapped()` = true, `vault.state()` shows the seed as WETH
   collateral at ~1x, `signal.isFresh()` = true, `signal.target()` matches the runner's printout.
4. Record `deployments/boost-eth-v1-live.json`:
   `{ "vault": "0x…", "signal": "0x…", "deployBlock": <block>, "deployedAt": "<UTC>" }`

## 3. Turn on the website and keeper

1. Vercel environment (Production and Preview): `NEXT_PUBLIC_BOOST_VAULT`, `NEXT_PUBLIC_BOOST_SIGNAL`,
   `NEXT_PUBLIC_BOOST_DEPLOY_BLOCK`. Redeploy. The `/boost` page switches from "launching soon" to live; Explore and My
   Vaults pick the vault up automatically.
2. The keeper workflow `.github/workflows/boost-keeper.yml` starts on its own once `deployments/boost-eth-v1-live.json` is
   on `main` (it is a watchdog loop like the Night LP and AutoLP keepers). Check the first run's log: an hourly `poke` and,
   when the signal is far from 1x, a first `rebalance` toward the target.
3. First 24 hours: watch leverage converge to the target in $100k-or-smaller hourly steps (at the seed size, one step).

## 4. Operating

| Situation | Action |
|---|---|
| Anything unexpected | `setDepositsPaused(true)` (treasury). Exits keep working. |
| Keeper down | Anyone can run `poke()` and `rebalance()`; the curator panel on `/boost` has a button. Missed hours are caught up in closed form. |
| Signal silent ≥ 24h (feed retired) | Anyone may step leverage down to 1x (dead-man switch); then pause deposits and plan a V2. |
| Sharp crash at full boost | Above 2.05x anyone may call `rebalance()` immediately (emergency cut, no interval, stale signal allowed). |
| steakUSDG illiquid | ETH withdrawals of the dollar sleeve revert; users can `exitInKind` (WETH + steakUSDG shares, no swap). |
| No USDG to borrow on Morpho | Nothing to do: the vault runs less boosted; deposits and exits work. |
| Monthly | `crystalliseFees()` (the keeper does it after 30 days). |

## 4b. v1.1 migration (KupiaSec emergency-rebalance fix, PR #15)

Status 2026-10-21: v1 deposits are paused and the treasury has withdrawn its position. v1.1 is the same vault with the fix,
on the live signal (no new signal, no seed file).

1. Merge PR #15. Run `FOUNDRY_PROFILE=boost forge test` on the merge commit, then in
   `deployments/boost-eth-v1.1-manifest.json` set `"status": "APPROVED"` and `"reviewedBuild"` to that commit.
2. Deployer `0xf63E…fC19` needs ≥ 0.008 ETH (0.005 seed + gas). Deploy (keystore password in Foundry's prompt only):
   `powershell -ExecutionPolicy Bypass -File scripts/run_boost_eth_deployer.ps1 -Manifest deployments/boost-eth-v1.1-manifest.json`
   The script refuses a stale signal; the Boosted keeper pokes it every 2 hours.
3. Treasury (Rabby): `acceptOwnership()` on the new vault, then deposit the ETH withdrawn from v1 on `/boost` once the
   site points at v1.1 (step 4), or directly with `deposit(treasury, minShares, deadline)`.
4. Switch over (one commit to `main`): `deployments/boost-eth-v1-live.json` → the new vault (keeper follows), Vercel
   `NEXT_PUBLIC_BOOST_VAULT` and `NEXT_PUBLIC_BOOST_DEPLOY_BLOCK` (the signal is unchanged), verify on Blockscout.
   Keep v1 listed as exit-only until no one but the dead shares holds it.
5. The keeper levers v1.1 to the signal's target in one slice at this size.

## 5. Never

- Never sign anything an automation prepared without reading it. Never share keystore passwords or the private RPC.
- The curator cannot move funds or change parameters; a parameter change is a new vault (V2) and a migration.
