# Fee Machine production runbook

## Fixed release

- Network: Robinhood Chain, chain ID 4663
- Curator and FEEX receiver: `0x134D468B0bcaeA6DF127916f951F7938c06A37C6`
- Deployer: `0xf63E63a80A25611154C5d1c06E55FD763E0cfC19`
- Token: HOODX Fee Machine (`FEEX`)
- Initial supply: 200 FEEX
- Public deposits: disabled
- Weights: 30/30/30/10

## Stop conditions

Do not deploy or fund if any of these is true:

- preflight status is not `READY_TO_DEPLOY_AND_BOOTSTRAP`;
- the curator cannot cover the exact seed plus gas reserve;
- any pool identity, fee, fee protocol, liquidity, lock, spot/TWAP, or center check fails;
- build or deploy-data hash differs from the reviewed manifest;
- gas exceeds the reviewed cap;
- the expected launcher address is already occupied or deployer nonce changed;
- the full protected bootstrap call does not simulate immediately before signing.

## Step 1 — fresh preflight

Build the exact launch contract and run `scripts/prepare_fee_machine_launch.mjs`. Archive `deployments/fee-machine-launch-preflight.json`. Repeat immediately before deployment because the seed, centers, nonce, gas, and market checks are live-state inputs.

## Step 2 — deployer transaction

Run `DeployFeeMachineV1.s.sol` with the exact seed and four centers in the fresh manifest. Live broadcast requires:

- `HOODX_LIVE_BROADCAST=1`
- `HOODX_DEPLOY_STAGE=fee-machine-pilot`
- `HOODX_REVIEWED_BUILD` equal to `buildFingerprint()`

The transaction sends zero ETH and deploys the launcher, four sleeves, index, and controller. Verify code and every getter before proceeding.

## Step 3 — curator bootstrap in Brave

Generate fresh swap quotes and protected minimums, repeat every pool check, and run a full `eth_call` of `bootstrapFromEth` from the official curator with the exact ETH value and a deadline no more than five minutes away. Only then show the single transaction in Brave.

The transaction must create liquidity in all four sleeves, mint exactly 200 FEEX to the curator, leave zero WETH in the index, reset launcher approvals, and refund launcher dust. A failure in any sleeve reverts everything.

## Step 4 — receipt and recovery verification

Verify the exact signer, destination, calldata, value, receipt status, event, runtime code hashes, ownership graph, supply, balances, four NFT IDs, nonzero liquidity, zero launcher approvals, and zero residual launcher balances.

On a fork of the receipt block, pause management, unwrap all FEEX, and redeem all four sleeve tokens independently. Do not perform that destructive recovery on production.

## Step 5 — publish

Only after receipt and recovery verification:

- write the deployment manifest and transaction links;
- add the FEEX pilot page and Explore card;
- publish the verified token image and contract address;
- label the product as a closed protocol pilot with public deposits disabled;
- begin the four-week realized-performance record.
