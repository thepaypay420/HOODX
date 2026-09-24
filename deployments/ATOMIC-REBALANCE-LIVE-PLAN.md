# Atomic rebalance live deployment plan

Prepared 2026-09-23 for Robinhood Chain 4663. Status: awaiting explicit live deployment authorization. No transaction in this plan has been broadcast.

## Reviewed build

- Build fingerprint: `0x741b2aa3228fcd9c4389af5274edec1eead900f68a4bef3dfde9b708d26cb853`
- Deployer: `0xf63E63a80A25611154C5d1c06E55FD763E0cfC19`
- Curator: `0x134D468B0bcaeA6DF127916f951F7938c06A37C6`
- Current deployer nonce: 99; recompute immediately before signing.
- Current deployer balance: 0.049277497024832 ETH; recompute immediately before signing.

If nonce 99 remains current, the expected controller addresses are:

1. 696X controller: `0x5A732854bD6A4EEa6e5bA9ED9D897bC089f58767`
2. FAANGX controller: `0xB5bCe75EB8761BF084F1abC71650b88311C9f4fb`

Addresses must be recalculated if the deployer nonce changes.

## Stage A: controller deployment only

Deploy one immutable V2 controller for each existing vault:

1. 696X vault `0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292`
2. FAANGX vault `0xCb40b8D79ff6f4c5db15bD8A9692B934b52cB0b0`

Both dry runs passed at current chain state. Estimated maximum fees were 0.000225712876019465 ETH and 0.000224714698579465 ETH. Use a combined deployment fee cap of **0.000500 ETH**, after refreshing the gas price and balance immediately before signing.

Deployment alone cannot call either vault and moves no vault assets. After each receipt, verify chain, sender, nonce, code, runtime hash, immutable vault, curator, and inactive authority.

## Stage B: curator activation

Only after both deployments verify:

1. Curator calls `696X.transferOwnership(exact696Controller)`.
2. Verify the vault owner remains the curator and pending owner equals the exact controller.
3. Curator calls `exact696Controller.activate()`.
4. Verify owner equals the controller and controller curator equals the curator wallet.
5. Repeat the same two calls and checks for FAANGX.

Each wallet request must show chain 4663, the exact target above, zero ETH value, and the expected selector. Stop on any mismatch or pending receipt.

## Stage C: bounded live proof

After activation, build a fresh current-state sell-first plan for one vault at a time. Requote every leg, retain the existing 3% protected minimums and cash reserve, simulate the complete controller call, then submit one atomic rebalance. Verify receipt, targets, balances, cash floor, controller authority, and zero controller token balances before enabling the public control.

Do not combine this stage with successor activation, production successor deployment, or vault migration.