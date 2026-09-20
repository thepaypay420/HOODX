# HOODX V2 checkpoint — 2026-09-19 Pacific

Checkpoint requested by the user. Further implementation and live deployment are paused pending this status report.

## Completed work

- Historical failure investigation and new isolated typed Universal Router execution architecture.
- Atomic normal withdrawal; router/oracle-independent in-kind reservations and retryable claims.
- Bounded automatic payout gas, fixing the gas-exhaustion denial of service found during security review.
- Independent V3 TWAP references with current/historical depth guards, pinned candidate routes and parameters.
- Separate creator/curator roles and constructor-only official configuration with no deployer admin.
- Original genesis price, minimum deposits, official fees, names and image metadata preserved.
- Foundry unit/fuzz/invariant/fork suites; Slither and Aderyn scans with documented triage.
- Gated V2 frontend, partial withdrawals, direct redemption, pending claims and route preflight.
- Versioned manifests, deployment/canary/recovery scripts, named-keystore signing runner, secret-safe local relay and CI workflow.

## Latest completed validation

- Contracts compile with Solidity 0.8.24. Warnings remain; compilation succeeds.
- Last complete local Foundry run: 94 test executions passed, zero failed. Includes repeated inherited base cases.
- Fuzz: 1,024 runs per fuzz case. Invariants: 128 x 64 calls, zero unexpected reverts.
- Latest targeted 24-asset test passed: first deposit 3,179,836 gas; repeated deposit 2,237,341; normal exit 2,299,102; direct redemption 2,387,935. These are mock-token measurements excluding fixture construction.
- Canonical Robinhood routing: 21 tests passed, including all 15 official constituents, larger swaps, USDG dust and a real hook.
- Full pinned official baskets: normal round trips passed at blocks 67591644 and 67610605.
- Stress block 67565367: normal 696X sale fails its protected minimum; shares remain intact and direct redemption succeeds. This is not a normal-canary pass.
- Frontend: 18 tests passed; exact checkpoint production build and TypeScript checks passed.
- Python: 110 passed, one pre-existing skip, 111 run.
- Dependency audit: zero known findings at recorded run.
- Secret scan: 182 tracked/candidate files, zero suspicious files before this checkpoint document.

The full suite has not been rerun after the final gas-logging-only test changes; the changed 24-asset test was run successfully. No production contract behavior changed in that final test edit.

## Failing tests and unresolved issues

No unexpected failing tests remain in the latest completed runs. Earlier strict normal-exit attempts at stressed blocks failed because market output breached the 97% TWAP floor. The protection is retained and the failure/recovery behavior is explicitly tested.

Unresolved release risks/work:
- Fixed oracle retention floors are pinned but are not a formal economic bound against sustained price manipulation. TWAP lag can temporarily block normal ETH exit.
- Token balanceOf correctness, non-rebasing balances, token upgrades and eventual transferability remain external assumptions.
- Only the tested hook capability is proven; arbitrary hooks remain unsupported.
- Static scans are not clean reports: Slither returned 89 findings; Aderyn returned three high and fifteen low categories. Triage is in V2_SECURITY.md. The concrete gas-exhaustion finding was fixed and regression-tested.
- Final receipt verification procedure, total smoke-gas funding calculation and release gates must be completed before live canary signing.
- Public factory creation/curator UI integration, production address activation, verification and Vercel preview remain.
- No GitHub push, PR or CI run is claimed by this local checkpoint.

## Wallet and on-chain status

Encrypted deployer creation and public-address derivation worked; live signing has not been exercised.

Public address: 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19

No live Robinhood transactions were broadcast.
No live canary stack or tests occurred.
No production Factory, 696X or FAANGX V2 deployment occurred.
Frontend V2 is implemented and gated off; production addresses are unchanged.

Unsigned final stack simulation estimated 49,336,364 gas and 0.006362614896232364 ETH at 0.128964001 gwei. This is one stack only, not a final total funding request.

## Stage and next steps

Stage: implementation and local/fork hardening, immediately before live-canary preparation. The live relaunch phase has not begun.

1. Close the remaining release checks, finalize whole-sequence funding estimates and preserve/publish the reviewable branch.
2. Once funded and explicitly enabled, use the encrypted keystore for both live canary normal round trips and verify actual receipts and balances.
3. Only after canary gates pass, deploy empty production contracts, verify roles/source, activate and test the frontend, then sweep remaining deployer ETH to the confirmed curator address.
