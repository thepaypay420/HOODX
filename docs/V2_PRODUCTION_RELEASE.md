# V2 production release checkpoint — 2026-09-20

This supersedes the historical pending gates in V2_RELEASE_VALIDATION.md. Main remains unchanged; publication is through the release branch and a preview PR.

- Both live canaries completed deposits, pause/emergency checks, partial/final withdrawals and capital recovery. All 74 canary receipts finalized; canary assets, shares, claims and residual token balances were verified empty.
- Production Factory, 696X and FAANGX deployed. All 19 creation receipts are canonical, successful and finalized. Reviewed creation inputs, executable runtime, roles, configurations and initially empty vault balances were checked.
- Sourcify verified all 19 contracts: 15 exact matches and 4 executable matches with metadata differences. Blockscout forwarding returned 403; verification there is not claimed.
- Production addresses and transaction hashes are in deployments/robinhood-4663-v2.json. The reviewed contract build is unchanged.
- Frontend uses the production factory and official vault registry, simulates wallet calls, supports partial withdrawals, direct asset redemption and claims, and exposes curator pause/emergency-unwind controls. The homepage lists the two official vaults; community vaults resolve by their factory slug.
- Frontend validation: 20 unit tests passed and Next.js production build passed. Prior Solidity validation: 94 local tests including fuzz/invariants, current-fork rehearsals and completed live canaries. These are engineering checks, not an independent audit.
- Remaining release gates: verify the GitHub/Vercel preview, review and explicitly merge main, and complete the final deployer sweep. No main merge or sweep has occurred at this checkpoint.

Production Factory: 0x5e846680bf8d702072b65e1e403d07e5a5f98b90

696X: 0x531832cd20d33ee974afee7ba5720b8f3f2c9292

FAANGX: 0xcb40b8d79ff6f4c5db15bd8a9692b934b52cb0b0

Protocol fee: 10 bps on deposits, paid as WETH to 0x134D468B0bcaeA6DF127916f951F7938c06A37C6.

Last read-only deployer balance: 0.107313362175501248 ETH; next nonce 89. Recompute fees and balance immediately before any sweep signature.
