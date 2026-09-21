# Opt-in successor: development checkpoint

Existing deployed V2 vaults are unchanged. No successor contract has been broadcast.
This checkpoint is not a release approval or a claim that arbitrary tokens are safe.

## Implemented foundation

- Separate V3 executor, vault and factory; existing V2 accounting is inherited.
- Canonical standard-fee V2 pair execution alongside V3/V4 execution.
- Delayed, code-hash-pinned hook registry with immediate owner revocation.
- Exact balance settlement checks; taxed V2 transfers are deliberately rejected.

## Recorded validation

- Successor local suite: 13 passed, including 1,024 fuzz runs of delta conservation.
  Mixed V2/V3 vault deposits, partial/final withdrawals and paused in-kind exits passed.
- Current-state watchlist fork at block 68590305: 19 passed, 1 failed (QUOTRON).
  Each case spends 0.001 ETH and sells all acquired tokens; quote-derived 97% floors
  and residual checks are execution diagnostics, not independent NAV protection.
- QUOTRON dedicated-router fork at block 68594108: passed. Contract purchase,
  executor/vault-like transfers, immediate full sale, zero token residue and zero
  remaining router allowance were checked. Initial quotes are discovered inside
  reverted snapshots, then trades repeat with 97% quote-derived floors.
  This diagnostic does not integrate that router into HoodxExecutorV3.

QUOTRON token: 0x5a86828efd322bfb16d93cfed16ee9bc14940d7f.
Its hook requires router 0x42024fcfdb4f3089dd619a0cef0cd24e7b841c18;
the generic router/quoter fails with NotRouter (0x91655201).
Verified router source was inspected through Sourcify. The diagnostic read a 300 bps
fee and returned 940899999999999 wei from 1000000000000000 wei, before gas.
Fee and transfer restrictions can change; one successful snapshot is not a guarantee.

Earlier PRISM and NET V2 attempts failed exact-output settlement due to transfer tax.
Their alternative V4 routes passed in the 19-token run. Preserve those rejection
checks; do not treat V2 pair presence as compatibility.

## Required before release

1. Implement and test a constrained QUOTRON integration with code/identity checks,
   exact approvals, refunds, recipient restrictions and failure rollback coverage.
2. Independent valuation for PRISM, NET, ZEAL, Aria, HARMONIC and PROMETHEUS:
   the discovery had no usable V3 history for these. Quotes/DEX market caps are not NAV.
3. Review hook and token proxy/dependency upgrade risks; runtime code hashes alone
   do not protect against implementation upgrades or mutable fee/transfer rules.
4. Confirm token identities, especially QUOTIENT, ZEAL and Aria, against curator intent.
5. Full basket accounting, multiple trade sizes, partial/final and in-kind withdrawals,
   adversarial/invariant checks, economic gas analysis and separate canaries.
6. User-facing admission workflow and explicit compatibility/fee explanations.

No live policy approval, asset migration or old-vault unwind is authorized by this
development checkpoint. Existing holders remain in existing vaults.
