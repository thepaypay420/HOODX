# Proportional successor independent review checkpoint

Date: 2026-09-22. Scope: the proportional successor contracts and transaction interface on `codex/token-compatibility`. This is an independent code review checkpoint, not a third-party audit or production approval.

## Resolved findings

1. **Taxed V2 route donation denial of service (P2).** The routing contract required pair balances to exactly match stored reserves, so an unsolicited one-wei transfer could disable a route. The settlement logic now permits balances above stored reserves and measures only the input added by the current call. A regression test verifies a donation neither disables the trade nor counts toward the caller's paid input.
2. **Fixed recovery recipient in the interface (P2).** In-kind redemption and deferred claims were always directed to the connected account. A wallet that rejects native ETH or cannot receive a constituent could not choose a recoverable destination through the interface. The successor desk now validates an editable recovery recipient and uses it for both operations.

## Post-fix evidence

- Targeted transfer-tax routing tests: 9 passed, including 1,024 fuzz cases.
- Proportional candidate suite: 23 passed, including 1,024 randomized joins.
- Complete Foundry suite: 201 passed, 0 failed, 12 explicitly skipped.
- Frontend suite: 61 passed; strict TypeScript and optimized production build passed.
- All 20 watchlist assets completed protected entry, partial ETH exit, paused in-kind recovery and final ETH exit at 0.02, 0.08 and 0.5 ETH on fork block 70274726.

## Residual review boundaries

- Dishonest balance reporting, rebasing behavior, sender-extra-debit tokens and hostile callbacks are not universally supported.
- Proxy implementations and admin powers can change after admission unless separately monitored and re-reviewed.
- Curator-authorized trades use explicit output and cash floors without an independent NAV guard.
- Real browser-wallet validation, live approvals, delayed hook activation and fully recovered live canaries remain release gates.

No live transaction was broadcast during this review or its validation.
