# Atomic rebalance security review

Date: 2026-09-23. Scope: `HoodxRebalanceControllerV2`, `HoodxRebalanceControllerV3`, the V3 exact-leg quote path, `HoodxAtomicFactoryV3`, deployment scripts, and curator frontend integration.

This is a focused internal review checkpoint, not a third-party audit or authorization to deploy.

## Result

No unresolved critical or high-severity issue was found in the reviewed scope. One release-blocking capability omission was found and fixed before deployment: the V2 controller did not initially forward `replaceConfig`, which would have prevented later oracle or route repairs after controller activation. The controller now forwards the call under the same curator-only and reentrancy protections, with a regression test.

## Security properties checked

- The controller never receives or approves vault assets. All trades execute from the vault through its existing reviewed executor and policy.
- Activation requires the pinned curator, the curator to remain current vault owner, and the controller to be the exact pending owner.
- Every state-changing management entry point requires both the pinned curator and live controller ownership.
- Rebalances enforce a short deadline, a current ordered constituent hash, unique assets, sell-before-buy ordering, and a final WETH cash floor.
- The V3 controller independently simulates each exact route against the vault's current balances immediately before executing that leg. It rejects curator-provided minimum output below 97% of that quote, rounded upward. The quote subcall always reverts, rolling back its approvals, transfers, swaps, and nonce changes. The same floor protects atomic legs, forwarded single trades, and emergency unwinds.
- V3 additionally pins the starting plan nonce and advances through the vault's nonce on every target or trade operation.
- A failure in any target update or trade reverts the complete transaction, including preceding sales.
- Ownership recovery uses the vault's existing two-step transfer. Pending release can be cancelled while the controller remains owner.
- Curator handoff is two-step and cannot be accepted by any account other than the nominated curator.
- Frontend execution refreshes balances/routes, requotes each leg, simulates the complete call, and then requests one wallet signature.
- The successor factory has no legacy non-atomic creation entry point. It deploys the controller and
  initializes it as vault owner in the same transaction that creates the vault.
- Creation accepts only the factory's current registered config ID for each token. The factory owner
  can register reviewed policy IDs but cannot substitute an unapproved policy route.

## Accepted limitations

- V2 has no native plan nonce. It is protected by constituent hash, deadline, final cash floor, fresh quote refresh, whole-call simulation, and curator-only execution. V3 has an explicit nonce.
- V2 purchases retain the vault's full post-buy oracle valuation. A broken configured oracle can block an atomic buy; the controller does not bypass that safety check.
- Deployment grants no authority. The curator must separately nominate the exact controller and call `activate()`.
- The controllers are immutable per vault. Changes require releasing ownership and reviewing a replacement controller.
- The same-transaction floor limits execution slippage from the configured route; it is not an independent fair-value oracle. A route whose pool was already manipulated or whose liquidity has become unsafe can still return a bad market price. Protocol route approval, liquidity review, curator reputation, and users' always-available proportional in-kind exit remain separate controls. Supporting every long-tail asset prevents a universal independent price check today.
- Curators control composition and targets. They cannot call an arbitrary token transfer, withdraw vault assets to themselves, bypass proportional user redemption, or make one successful leg persist after another leg fails. Users still assume the disclosed strategy risk that a curator can allocate among protocol-approved assets.

## Validation

- Full Solidity suite: 222 passed, 0 failed, 14 live-fork tests skipped when the RPC is absent.
- Focused V2 controller suite after the maintenance fix: 8 passed, 0 failed.
- Current-state Robinhood fork: 696X and FAANGX atomic sell rehearsals passed.
- Current-state Robinhood successor rehearsal: all 20 registered routes, 23 setup transactions, and one-transaction vault/controller creation passed on a disposable fork. Measured 20-asset creation gas: 8,612,284.
- Frontend: 68 tests passed and production build passed.
- Runtime size: V3 vault 24,366 bytes, V3 controller 12,709 bytes, and atomic factory 18,187 bytes; all are below the EIP-170 runtime limit.
