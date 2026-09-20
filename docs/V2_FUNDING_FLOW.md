# V2 funding and treasury flow

User-confirmed flow (2026-09-19):

1. User funds the disposable deployer: 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19.
2. Deployer deploys the contracts required for the canary.
3. Deployer makes the live canary deposits.
4. Canary withdrawals return to the deployer.
5. Complete the gated production deployment, verification and role setup.
6. After all required transactions and checks succeed, sweep remaining deployer ETH to 0x134D468B0bcaeA6DF127916f951F7938c06A37C6, accounting for the sweep transaction fee.

The sweep destination is fixed; no other recovery recipient is authorized. Never sweep vault backing, user reserves or another account's assets. A failed or unresolved canary stops production launch and requires recovery/accounting before the deployer balance is swept.

Funding must be based on simulation gas estimates plus explicitly itemized canary capital and a gas buffer. This flow does not bypass the test, release, encrypted-keystore or live-broadcast gates in the original brief. The deployer must retain no long-term privileged role.
