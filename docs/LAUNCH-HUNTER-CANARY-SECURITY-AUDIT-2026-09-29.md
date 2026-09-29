# Launch Hunter V1 — Closed Canary Security Audit

Date: 2026-09-29
Scope: `HoodxLaunchHunterV1`, its one-purpose launcher, deployment/verification scripts, and the official-curator bootstrap signer.

## Decision

The reviewed build is suitable for a **closed, protocol-funded $200 canary**. Public deposits and permissionless candidate admission are intentionally absent. No yield or safety claim should be published until live observations satisfy the research promotion gates.

## Trust and authority

- The official curator `0x134D…37C6` owns the append-only route policy and is the only address that can arm candidates, enter probes, recover principal, pause new entries, or make an emergency market exit.
- Any caller may record a higher price and enforce the 12-hour exit or the post-recovery trailing exit. This prevents curator absence from extending the intended holding window.
- Any HUNTX holder can redeem directly for proportional WETH and held tokens without a router, oracle, web app, or backend.
- The launcher receives no ownership and exposes no administrative method.

## Tested protections

- Exact one-time bootstrap; wrong amount and repeat bootstrap revert.
- 24-hour candidate observation delay.
- Maximum five active candidates, one candidate per creator/funder cluster.
- Immutable 0.5% seed cap per candidate and 2.5% aggregate risk cap. Donations and profits cannot expand these absolute limits.
- Five-minute execution deadline, 95% oracle floor, fresh config lookup, and runtime-codehash check on every trade.
- Principal recovery requires both a 1.5x oracle value and actual WETH received at least equal to the original probe.
- Temporary token allowances are cleared after executor calls.
- A reverting token transfer cannot block WETH recovery or recovery of other assets; the failed asset becomes separately claimable.
- Sequential holders redeem proportionally without stranding assets.
- A token donation can block its own entry but cannot permanently poison the vault: the inactive candidate can be cancelled and the unexpected token rescued.
- A post-review runtime mutation fails closed.
- Production-fork tests verify exact dependency identities, ownership, bootstrap behavior, role boundaries, and route-independent redemption.

## GRIEFING READINESS

### Website, API, RPC

The canary adds no public quote, scanner, historical-cost-basis, image proxy, or market-data endpoint. Deployment and bootstrap utilities bind to localhost, perform bounded RPC calls with 20-second timeouts and one retry, simulate before signing, and never retry a transaction automatically. An RPC outage fails closed. The wallet signer requires the exact official curator and Robinhood Chain.

No provider-level WAF claim is made because the candidate scanner is not public in this release. Before a public scanner exists, it must have per-IP and aggregate budgets, bounded concurrency, cached chain reads, strict input sizes, upstream timeouts, and fail-closed rate-limit storage. Those settings remain **UNVERIFIED** because no public service exists to inspect.

### Factory and listing spam

There is no public Launch Hunter factory, public deposit function, or automatic discovery listing in V1. Candidate configs are append-only and curator-owned. The vault caps active candidates at five and never reads token-controlled names, images, or arbitrary metadata. A malicious candidate therefore cannot force all visitors to download metadata or expand per-call iteration beyond five assets.

### Contract and withdrawal griefing

Dust donations, unsolicited candidate donations, role abuse, maximum active slots, runtime mutation, expiry, trailing exits, reverting transfers, and sequential redemption were tested. Withdrawal reserves each asset before attempting transfers and isolates each transfer. Failed transfers leave an explicit claim rather than rolling back unrelated recovery. Entry and market exits may fail when an oracle, executor, token, or pool fails; direct in-kind redemption remains available and does not call them.

Tokens with pathological `balanceOf`, `decimals`, or oracle behavior cannot be safely admitted and must fail the per-candidate review. Direct transfers of fee-on-transfer tokens may deliver less than the nominal reserved amount; that token behavior must be disclosed in candidate evidence. Candidate-specific gas-heavy behavior remains **UNVERIFIED** until the exact token and routes are fork-tested.

### Final hook cooldown

The PONS V2 hook `0xE5e7…e044` is already active in the live registry, so the first PONS-family candidate does not depend on a cooldown. The separate Doppler hook proposal remains pending until its exact on-chain eligibility time. This release does not bypass, reset, cancel, extend, or activate that proposal. The registry's stored hook and evidence hash are checked as exact values; an attacker cannot substitute a different hook through the Launch Hunter contracts. Failed hook execution affects market trades but does not affect in-kind withdrawal.

### Safe failure

- RPC unavailable: deployment/bootstrap preparation stops; no transaction is constructed from stale fallback data.
- Oracle, route, liquidity, or executor unavailable: entry/market exit fails; existing HUNTX can still redeem in kind.
- Malicious/reverting asset transfer: WETH and other assets continue; only that asset is deferred for a later claim.
- Curator unavailable: no new risk can be opened; expiry and trailing exits remain permissionless.

## Open launch gates

Each candidate still requires an exact token-address review, creator/funder cluster evidence, oracle validation, buy-and-sell route validation, transfer-tax review, and current-fork round-trip test. No candidate is approved by this audit. Candidate admission without that evidence is a launch blocker for that candidate, not for deploying and funding the empty canary.

No unresolved critical or high finding remains in the reviewed closed-canary contract. Public deposits, automated admission, or public factory use require a new audit.

