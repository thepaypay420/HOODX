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
- Independent frontend arithmetic for deposit and withdrawal plans, pinned-block quote checks and 60-second quote freshness. This library is not yet connected to the live app.

## Validation evidence

- Solidity 0.8.24, optimizer 1, via IR, Cancun: compilation succeeded. Final implementation runtime: 21,848 bytes, below EIP-170's 24,576-byte limit. Source/compiler matching passed for all three contracts; template fingerprints and dependency source hashes are recorded in proportional-build-check.json.
- 19 candidate unit/fuzz tests passed, including 1,024 randomized joins.
- Two accounting invariants passed over 128 runs of 64 actions, 8,192 handler calls, with no handler reverts. Foundry reports the combined invariant campaign as one test (20 total candidate results).
- 66 existing V3 local regression tests passed.
- Nine frontend plan tests, all 47 frontend regression tests, and the project TypeScript check passed.
- Full 20-token lifecycle passed at Robinhood block **69792788**: 0.08 ETH bootstrap, second-user exact-share deposit with 0.05 ETH maximum, partial ETH withdrawal, paused in-kind exit, and original holder's final ETH exit. Every token had a positive initial holding. Assertions verified incumbent backing, resolved newcomer claims, zero final free token/WETH balances and zero routing-contract token residue. Protocol/creator fee claims intentionally remain reserved.
- Assets: PONS, AI, CASHCAT, Index, MEME, STONKBROKER, PRISM, HOOKR, DELTA, SHROOM, BOW, UP, QUOTRON, NET, ZEAL, website, Aria, HARMONIC, QUOTIENT, PROMETHEUS.
- QUOTRON uses its specialized approved route. This is not the previously failing generic route.
- The fork fixture creates its own approvals and matures its hook approval in simulated time. It does not establish that corresponding live approvals exist.
- Fork quote probes use minimum 1 only inside rolled-back snapshots; actual bootstrap and ETH-sale calls enforce positive 97% quote floors. Exact-share joins enforce required token quantities. Both partial and final fork withdrawals also enforce an aggregate minimum of cash plus protected sale outputs, matching the frontend planner. The strengthened rerun passed at the same block.
- No live transaction or deployment was broadcast by these tests.

Reproduce the basket test with `node --use-system-ca scripts/run_watchlist_fork.mjs --successor --proportional-candidate --block=69792788`, with RPC privately configured. The relay permits read-only RPC methods only. Local logs are outside the repository in `../outputs/proportional-candidate-fork.txt`, `proportional-candidate-local-final.txt`, and `successor-local-regression.txt`.

## Material model differences and outstanding release gates

1. Deposits replicate actual holdings, not target weights. The genesis share denomination is not NAV. Indicative portfolio value and performance must remain display-only.
2. Curator trades use explicit curator-signed output/cash floors, without the old independent-price guard. This increases curator execution trust. The UI and product review must make that clear before launch; target cash percentage is not continuously oracle-enforced.
3. Token admission still requires token/proxy, fee, liquidity, hook and sellability review. Runtime hashes do not pin proxy implementations. Rebases, false balance reporting, sender-extra-debit and hostile callbacks are not universally supported. The tested watchlist at one block is not a promise that arbitrary future tokens are safe.
4. Complete and review the affordable-share quote solver, real route quotes, net transfer-tax handling, wallet simulation, chain/address identity checks, claim UI and successor-only frontend integration. Do not expose the arithmetic library as a complete quote service.
5. Extend adversarial review and regression coverage for malicious callbacks, changing taxes, proxy upgrades, concurrent balance changes, multiple users and different basket sizes/trade sizes. Obtain an independent security review of the changed economic model and implementation.
6. Produce final source/build fingerprints, deployment manifests, live hook/policy approval evidence, funding envelope and canary procedures. Refresh full-watchlist rehearsal immediately before signing.
7. Run and recover a bounded live canary only after those gates and explicit live authorization. Production launch remains stopped until receipts, roles, fees, dust and recovery are verified.

No assertion of production readiness or universal asset compatibility is made by this checkpoint.
