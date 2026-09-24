# Atomic rebalance security review

Date: 2026-09-23. Scope: `HoodxRebalanceControllerV2`, `HoodxRebalanceControllerV3`, the V3 exact-leg quote path, deployment script, and curator frontend integration.

This is a focused internal review checkpoint, not a third-party audit or authorization to deploy.

## Result

No unresolved critical or high-severity issue was found in the reviewed scope. One release-blocking capability omission was found and fixed before deployment: the V2 controller did not initially forward `replaceConfig`, which would have prevented later oracle or route repairs after controller activation. The controller now forwards the call under the same curator-only and reentrancy protections, with a regression test.

## Security properties checked

- The controller never receives or approves vault assets. All trades execute from the vault through its existing reviewed executor and policy.
- Activation requires the pinned curator, the curator to remain current vault owner, and the controller to be the exact pending owner.
- Every state-changing management entry point requires both the pinned curator and live controller ownership.
- Rebalances enforce a short deadline, a current ordered constituent hash, unique assets, sell-before-buy ordering, positive protected outputs, and a final WETH cash floor.
- V3 additionally pins the starting plan nonce and advances through the vault's nonce on every target or trade operation.
- A failure in any target update or trade reverts the complete transaction, including preceding sales.
- Ownership recovery uses the vault's existing two-step transfer. Pending release can be cancelled while the controller remains owner.
- Curator handoff is two-step and cannot be accepted by any account other than the nominated curator.
- Frontend execution refreshes balances/routes, requotes each leg, simulates the complete call, and then requests one wallet signature.

## Accepted limitations

- V2 has no native plan nonce. It is protected by constituent hash, deadline, final cash floor, fresh quote refresh, whole-call simulation, and curator-only execution. V3 has an explicit nonce.
- V2 purchases retain the vault's full post-buy oracle valuation. A broken configured oracle can block an atomic buy; the controller does not bypass that safety check.
- Deployment grants no authority. The curator must separately nominate the exact controller and call `activate()`.
- The controllers are immutable per vault. Changes require releasing ownership and reviewing a replacement controller.

## Validation

- Full Solidity suite: 216 passed, 0 failed, 14 live-fork tests skipped without RPC.
- Focused V2 controller suite after the maintenance fix: 8 passed, 0 failed.
- Current-state Robinhood fork: 696X and FAANGX atomic sell rehearsals passed.
- Frontend: 66 tests passed and production build passed.
- Runtime size: V2 controller below the EIP-170 limit; V3 controller below the EIP-170 limit.