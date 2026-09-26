# Proportional successor release candidate

Checkpoint: 2026-09-22. **Not approved for production deployment.** Existing V2 vaults and their assets are unchanged.

## Implemented

- Separate execution-only policy, implementation and factory namespace; explicit accounting-mode identity.
- Creator/curator-only bootstrap with per-token execution floors, bounded fees, and exclusion of pre-existing donations and claims.
- ETH-only exact-share deposits. For every held token and cash, retain at least `ceil(balance * newShares / oldSupply)`. Final measured balances determine acceptance, not spot valuations or executor return values.
- Surplus tokens belong to the depositor. Unspent ETH is refunded. Failed bounded transfers remain individually claimable and excluded from basket backing.
- Fees charged on ETH actually consumed, with treasury and creator claims isolated from investor assets.
- Proportional ETH withdrawals with per-sale and aggregate floors; in-kind recovery while paused; reserved claims survive a full exit and reopening.
- Expiring transaction plans and configuration nonce invalidation; route approvals cleared after execution.
- Curator constituent, target, pause and trade controls. Adding an empty sleeve does not make proportional deposits purchase it; the curator must fund it through a separate rebalance.
- Vault-native buy and withdrawal quotes always revert after simulation. External failures are masked so a route cannot forge a successful quote result. No quote can commit a trade.
- Bounded affordable-share solver (at most four complete-basket simulations), pinned-block quotes, 60-second freshness, exact-share plans and aggregate withdrawal floors.
- Separate successor transaction screen with ETH presets, percentage/Max exit quotes, balance and claim reads, in-kind recovery, curator pause, current-state simulation, gas/balance checks, wallet identity checks, and pending receipt tracking. The release manifest is deliberately inactive; existing V2 pages are unchanged.

## Validation evidence

- Solidity 0.8.24, optimizer 1, via IR, Cancun: compilation succeeded. Final implementation runtime: 24,366 bytes, below EIP-170's 24,576-byte limit. Source/compiler matching passed for all seven infrastructure contracts; the reviewed aggregate build fingerprint, template fingerprints and dependency source hashes are recorded in proportional-build-check.json.
- 23 candidate unit/fuzz tests passed, including 1,024 randomized joins.
- Two accounting invariants passed over 128 runs of 64 actions, 8,192 handler calls across two independently acting handler accounts, with no handler reverts. Foundry reports the combined invariant campaign as one test (24 total candidate results).
- 66 existing V3 local regression tests passed.
- The complete Foundry suite passed: 201 tests, 0 failures and 12 explicitly skipped tests. This includes the V2/V3 unit and fuzz suites plus the V2, V3 and proportional 8,192-call invariant campaigns.
- All 61 frontend tests, strict TypeScript, and the optimized production frontend build passed.
- The actual frontend quote adapter passed a disposable Anvil integration test: native quote errors decoded, deposit simulated and mined, Max exit simulated and mined, final supply/free assets zero. These were synthetic local accounts/contracts, not Robinhood broadcasts.
- After the security-review fixes, the bounded affordable-share solver passed the full 20-token lifecycle on fresh Robinhood RPC block **70274726** for bootstrap sizes 0.02, 0.08 and 0.5 ETH. All three cases had protected entry and sales, partial ETH exit, paused in-kind recovery and final ETH exit.
- Full 20-token lifecycle passed at Robinhood block **69792788**: 0.08 ETH bootstrap, second-user exact-share deposit with 0.05 ETH maximum, partial ETH withdrawal, paused in-kind exit, and original holder's final ETH exit. Every token had a positive initial holding. Assertions verified incumbent backing, resolved newcomer claims, zero final free token/WETH balances and zero routing-contract token residue. Protocol/creator fee claims intentionally remain reserved.
- Historical 20-asset test set: PONS, AI, CASHCAT, Index, MEME, STONKBROKER, PRISM, HOOKR, DELTA, SHROOM, BOW, UP, QUOTRON, NET, ZEAL, website, Aria, HARMONIC, QUOTIENT, PROMETHEUS. The current 21-asset manifest is recorded below.
- QUOTRON uses its specialized approved route. This is not the previously failing generic route.
- The fork fixture creates its own approvals and matures its hook approval in simulated time. It does not establish that corresponding live approvals exist.
- Vault quote probes use minimum 1 only inside always-reverting simulation calls; actual bootstrap and ETH-sale calls enforce positive 97% quote floors. Exact-share joins enforce required token quantities. Both partial and final fork withdrawals also enforce an aggregate minimum of cash plus protected sale outputs, matching the frontend planner. The strengthened rerun passed at the same block.
- No live transaction or deployment was broadcast by these tests.

Reproduce the current basket test with `node --use-system-ca scripts/run_watchlist_fork.mjs --successor --proportional-candidate --block=70274726`, with RPC privately configured. Run it at 0.02, 0.08 and 0.5 ETH. The relay permits read-only RPC methods only.

## Material model differences and outstanding release gates

1. Deposits replicate actual holdings, not target weights. The genesis share denomination is not NAV. Indicative portfolio value and performance must remain display-only.
2. Curator trades use explicit curator-signed output/cash floors, without the old independent-price guard. This increases curator execution trust. The UI and product review must make that clear before launch; target cash percentage is not continuously oracle-enforced.
3. Token admission still requires token/proxy, fee, liquidity, hook and sellability review. Runtime hashes do not pin proxy implementations. Rebases, false balance reporting, sender-extra-debit and hostile callbacks are not universally supported. The tested watchlist at one block is not a promise that arbitrary future tokens are safe.
4. Browser-wallet UX validation remains required. The quote solver, actual-execution probes, simulation adapter, release identity checks, alternate recovery recipient and inactive successor screen are implemented; the synthetic adapter integration passed. They have not yet been exercised through a real wallet on a live successor.
5. An independent code/security review found two medium-priority availability and recovery issues. Both are fixed: unsolicited pair-token donations no longer disable taxed V2 routes or count as paid input, and users can direct in-kind recovery or deferred claims to a different valid recipient. Targeted regressions, the complete test suite and the refreshed live-state fork lifecycle pass after those fixes. The findings, fixes and residual boundaries are recorded in `PROPORTIONAL-SECURITY-REVIEW.md`. This review is evidence, not a third-party audit or a promise of universal hostile-token safety.
6. Final contract source/build fingerprints and an exact local-fork infrastructure rehearsal are saved. Live deployment manifests, reviewed live hook/token approval evidence and the complete per-stage signing envelope remain required. Refresh the full-watchlist rehearsal immediately before signing.
7. Run and recover a bounded live canary only after funding, the approval delay, wallet validation and explicit canary-only authorization. Production launch remains stopped until receipts, roles, fees, dust and recovery are verified.

No assertion of production readiness or universal asset compatibility is made by this checkpoint.

## Infrastructure and funding checkpoint

The exact local-fork infrastructure rehearsal succeeded at RPC fork block **70283904**: seven deployments and two delayed hook proposals (nine simulated transactions, zero live receipts). Gas used was 13,364,239; the 25% padded estimate was 16,705,302 at a 111,124,000 wei max-fee assumption, or **0.001856359979448 ETH**. This excludes token approvals, canary creation, trading and capital. The rehearsal uses a disposable Anvil fork behind a read-only localhost relay, which rejects upstream transaction-send methods. The simulated addresses are not live deployments.

At the latest refresh the deployer 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19 held **0.000005229504 ETH**, with latest and pending nonce 90. Funding is insufficient. Proposed minimum-size canary funding target: 0.05 ETH balance, comprising 0.02 ETH bootstrap, up to 0.02 ETH repeat entry and 0.01 ETH reserve. This is not a spending authorization or a guaranteed total cost. Funds recovered may be reduced by gas, trading fees, transfer taxes and market movement. Refresh all fees immediately before signing. The registry has a 172,800-second delay; its live timer has not started.

Funding was subsequently refreshed on 2026-09-23 at **0.050005229504 ETH**. All three protected 20-token lifecycles passed again at block 70335738. The exact nine-transaction infrastructure rehearsal passed at block 70338902 with a 0.001826825005512 ETH combined maximum-fee envelope. The concrete stage, evidence hash and stop conditions are recorded in `PROPORTIONAL-INFRASTRUCTURE-LIVE-PLAN.md`. The stage still awaits explicit successor-canary-infrastructure broadcast authorization; funding alone is not authorization.

The user explicitly authorized that bounded infrastructure stage and all nine transactions succeeded. Verified live addresses, transaction hashes, roles, dependency reads, inactive proposals, activation time, actual gas and remaining balance are recorded in `PROPORTIONAL-LIVE-INFRASTRUCTURE.md`. This does not authorize hook activation, route approvals, canary creation or production.

Additional reproduction: `node scripts/proportional_local_e2e.cjs` compiles the actual adapter and starts/cleans a disposable localhost-only Anvil chain. `node --use-system-ca scripts/rehearse_proportional_infrastructure.mjs` performs the exact nine-transaction infrastructure rehearsal without sending anything upstream. Structured results are recorded in `proportional-build-check.json` and `proportional-infrastructure-rehearsal.json`.

## 2026-09-26 watchlist refresh

The current candidate contains 21 assets: PONS, AI, CASHCAT, Index, MEME, STONKBROKER, PRISM, HOOKR, DELTA, SHROOM, BOW, UP, QUOTRON, NET, ZEAL, musebook, Aria, HARMONIC, QUOTIENT, PROMETHEUS and STELX. It removes website, adds musebook at `0x91A2DAe9699f0B82540B5886b0d8759C22820bA3`, and adds STELX at `0x7A8cda6A1cAB3e5146Cd13Cb623a3bb284fb4aD1`.

The new route fingerprint is `0x6e099c7bc199851686bca108bde88de3f20531e953352a4102712ef1ca03b93a`. PONS, AI and CASHCAT each target 3.58%; the other 18 assets each target 3.57%, for an exact 75% asset allocation and 25% cash target. Protected 21-asset lifecycles passed at 0.02, 0.08 and 0.5 ETH on blocks 72940538, 72942662 and 72943478. The exact live-state fork rehearsal also passed at block 72943478 using the matured-but-inactive hook proposals, the curator-owned route administrator, the live policy, implementation and factory. No production transaction was broadcast.
