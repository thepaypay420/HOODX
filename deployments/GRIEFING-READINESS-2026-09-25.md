# HOODX anti-griefing readiness review

Date: 2026-09-25  
Scope: current web application, public API routes, V2 live vault code, V3 proportional vault/factory/controller code, and the delayed hook registry.  
Constraints observed: no production transactions, role changes, upgrades, redeployments, cooldown bypasses, or live load/attack tests. Contract execution was tested in unit environments and read-only local forks.

## GRIEFING READINESS

**Result: CONDITIONAL PASS.** No critical or high-severity griefing exploit was confirmed. Five medium availability findings were identified. Four website findings are fixed in this change. One deployed V2 limitation remains: a zero-valued dust donation to a listed but otherwise empty constituent can disable priced NAV and ordinary ETH withdrawal. Failed withdrawals preserve shares, and direct in-kind redemption remains available. The live contract cannot be corrected under this review's no-upgrade constraint.

Public launch remains conditional on publishing the provider controls under **Manual launch controls**. The application limits are per server instance; only an edge rule can enforce a budget across instance rotation and alternate deployment URLs.

### Evidence summary

- Web tests: **94 passed** across 25 files. New tests cover aggregate-budget exhaustion, spoof-independent admission, concurrency caps, fail-closed guard corruption, random-address negative caching, the 512-key cache ceiling, oversized market responses, image-host validation, and streamed 2 MB image limits.
- Contract unit/invariant tests: **245 passed** across 25 suites. This includes 24-asset worst paths, 1,024-run fuzz cases, 8,192-call invariants, reverting/gas-burning routes and recipients, donations, atomic rollback, claims, and recovery.
- Hook cooldown: **5 focused tests passed** before expiry, at exact expiry, after expiry, unauthorized scheduling/reset/cancel, owner rescheduling, exact hook/codehash pinning, code mutation, repeated activation, cancellation, and failed activation rollback.
- Local fork: all **10 official V3 vault definitions** bootstrapped at 0.02 ETH and fully exited; the **20-token proportional watchlist** completed its full entry/exit lifecycle; live 696X and FAANGX controller healing plus full ETH exit both passed on local forks.
- Build: Next.js 16.3.5 production build passed.

### Credible attacks and controls

#### 1. Random market-data cache misses

- Prerequisite: public access to `/api/holding-market`.
- Reproduction: submit batches of 24 unique syntactically valid token addresses.
- Prior impact: each request could create 24 persistent cache keys and 24 concurrent Dexscreener calls.
- Protection: an aggregate token bucket charges per token, allows at most four concurrent requests and four concurrent upstream calls, ignores wallet/IP/forwarded headers, deduplicates concurrent misses, negative-caches misses, caps the LRU at 512 keys, limits a response to 1 MB and 256 pairs, uses a six-second timeout, and performs no retry.
- Result: **FIXED AND TESTED**. Multi-instance coordination remains an edge-control item below.

#### 2. Image download amplification and server-side URL abuse

- Prerequisite: a market record containing an image URL.
- Reproduction: request many image addresses or return a very large/chunked image.
- Prior impact: complete bodies were buffered before the size check; any HTTPS host supplied by the upstream record could be contacted.
- Protection: aggregate budget and concurrency cap, six-second timeout, redirect refusal, exact Robinhood/Dexscreener HTTPS host policy, MIME allowlist, declared-size check, and streaming cancellation above 2 MB.
- Result: **FIXED AND TESTED**.

#### 3. Failed vault quote amplification

- Prerequisite: a verified V2 vault with one consistently failing quote leg.
- Reproduction: repeatedly request the vault quote after failures.
- Prior impact: every failure could replay vault reads and up to four simulations per held asset.
- Protection: verified-vault allowlist, two-request concurrency cap, aggregate rate budget, ten-second RPC timeout, zero retries, and a cacheable 60-second negative result.
- Result: **FIXED AND TESTED AT THE ADMISSION/CACHE LAYER**. Provider outage behavior is fail-closed with HTTP 503.

#### 4. Cost-basis reconstruction amplification

- Prerequisite: make a tracked balance differ from the saved checkpoint, then create many transfers mentioning the vault or make the indexer unavailable.
- Reproduction: force reconstruction and repeatedly request it.
- Prior impact: up to 100 explorer pages followed by an open-ended historical RPC scan.
- Protection: verified-vault allowlist, one-request concurrency cap, low aggregate budget, ten-second RPC timeout, zero retries, 60-second negative caching, 12 explorer pages maximum, 1,000 records per page maximum, tracked-token filtering, and 48 RPC chunks (480,000 blocks) maximum.
- Result: **FIXED AND TESTED AT THE ADMISSION LAYER; BOUNDS VERIFIED BY CODE/BUILD**. A request that exceeds the history budget fails closed rather than scanning indefinitely.

#### 5. Permissionless factory/listing spam and fake official identity

- Prerequisite: gas to create many unique vault slugs or misleading names.
- Reproduction: create empty clones and emit duplicate/malicious metadata designed to make visitors scan and render them.
- Prior impact: each visitor scanned complete factory history, read approximately four properties per clone, and rendered every result.
- Protection: automatic permissionless discovery was removed. Official discovery remains a static verified set. Community discovery reads a curated manifest capped at 24 rows and validates address, slug, name and symbol bounds. Community rows are always labeled `Community index`; no community metadata can acquire official presentation. Direct access by valid factory slug and permissionless contract creation remain unchanged.
- Contract bounds: 2–24 assets, unique configurations/slugs, name <=64 bytes, symbol <=16 bytes, image URI <=256 bytes and HTTPS/IPFS scheme.
- Result: **FIXED AND TESTED BY BUILD/STATIC BOUNDS**. Editorial admission policy and review ownership are operational processes and remain **UNVERIFIED**.

#### 6. Dust, donation, rounding and minimum-operation griefing

- Prerequisite: ability to transfer assets directly to a vault.
- Reproduction: donations before/after genesis, dust balances, repeated bounded round trips, and minimum-share operations.
- Protection/evidence: donation value does not create profitable bounded round trips; genesis donations become treasury claims; proportional V3 joins conserve backing and round required contributions upward; reserved assets cannot fund another join; zero-share/minimum limits reject unusable operations.
- Result: **TESTED** through fuzz and invariant suites.

#### 7. Reverting/gas-heavy asset, route, hook, and recipient

- Prerequisite: one basket asset, route, hook, or payout recipient fails or consumes its stipend.
- Reproduction: revert/invalid opcode on transfer or route, reject native payout, remove liquidity, or fail the last atomic leg.
- Protection/evidence: priced operations revert atomically before shares are lost; preferred-route failure can use only approved healthy fallbacks; all-fallback failure rolls back; in-kind redemption reserves only the failed transfer and pays unrelated assets; claims can be retried to a different recipient; atomic rebalance restores targets, balances and nonce on later-leg failure.
- Result: **TESTED**. One asset cannot trap unrelated in-kind proceeds.

#### 8. Maximum basket and worst path

- Prerequisite: a 24-asset basket and maximum normal operations.
- Reproduction: first/repeated deposit, ETH exit, and direct redemption across 24 assets.
- Protection/evidence: hard 24-asset contract bound; 24-asset gas tests passed (about 3.27M first deposit, 2.34M repeated deposit, 2.38M ordinary withdrawal, 2.39M direct redemption in the test fixture). V3 route candidates and atomic steps are separately bounded.
- Result: **TESTED**.

#### 9. Deployed V2 zero-value dust denial

- Prerequisite: a listed V2 constituent has zero free balance and one raw donated unit rounds to zero in its current oracle.
- Reproduction: donate one raw unit, then call `totalAssets` or ordinary `withdraw`.
- Impact: priced NAV/deposit/ordinary ETH withdrawal reverts; curator removal also requires a zero balance.
- Protection: failed withdrawal does not burn shares or alter bags. `emergencyRedeemInKind` does not use prices/swaps and succeeds, with any failing transfer retained as a retryable claim.
- Result: **CONFIRMED MEDIUM DEPLOYED-CODE LIMITATION**. Remediation for a future implementation: ignore/reserve balances below a proven value threshold or let the curator quarantine non-economic dust without relying on its oracle. This requires separate design/security review and deployment approval. No live contract change was made.

### Final hook cooldown review

- Schedule/reset/extend: only the registry owner can call `propose`; re-proposal replaces the same hook's proposal and restarts its two-day delay.
- Cancel/revoke: only the owner can call `revoke`; it clears both pending and active approval.
- Finalize: anyone can call `activate` after `readyAt`; the caller cannot choose a replacement because the proposal is keyed by the exact hook and pins its runtime codehash.
- Expiry: there is no expiry after the cooldown. A proposal remains eligible unless the owner revokes/reschedules it or the hook code changes.
- Transaction ordering: non-owners cannot reset or cancel. At the exact timestamp activation succeeds. A second activation fails. Owner revoke/re-propose can intentionally win ordering, which is privileged governance behavior rather than attacker control.
- Failed activation: reverts without deleting the proposal. Changed/missing code cannot activate. The intended proposal remains inspectable.
- Failed hook/liquidity execution: route and rebalance failures roll back atomically. Withdrawal fallbacks and direct in-kind recovery remain independent of registry activation and website availability.
- Result: **PASS for the tested registry lifecycle**. Proxy implementations and external dependencies behind an approved hook are not detectable from the hook runtime codehash and remain **UNVERIFIED**; the contract itself documents this limitation.

### Outage and safe-failure behavior

- RPC outage: quote and cost-basis routes time out, do not retry, cache failures briefly, and return 503. They do not fall back to unrestricted work.
- Market/indexer outage: bounded timeouts, capped fallback work, negative caching, and aggregate admission remain active.
- In-process guard corruption: tested to fail closed with 503.
- Cold starts/multiple instances: local budgets reset per instance. This is why the WAF controls below are mandatory.
- Cache loss: causes bounded recomputation; it does not disable limits.
- Direct withdrawals/recovery: no new website, CAPTCHA, API, cache, database or WAF dependency was added to on-chain withdrawal, in-kind redemption, or claims.

### Manual launch controls

The production response identifies the host as Vercel. Vercel documents [automatic L3/L4/L7 DDoS mitigation](https://vercel.com/docs/vercel-firewall/ddos-mitigation) on all plans, but project-specific settings are not visible from this repository.

Before public launch, configure and record screenshots/exported rules for:

1. **[Vercel WAF rate limits](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)** using both IP and JA4 counting keys, returning 429:
   - `/api/vault-cost-basis`: 6 requests per minute per source.
   - `/api/vault-quote`: 30 requests per minute per source.
   - `/api/holding-market`: 30 requests per minute per source.
   - `/api/holding-image/*`: 60 requests per minute per source.
2. **[Standard Deployment Protection](https://vercel.com/docs/deployment-protection)** for preview and generated deployment URLs so alternate URLs cannot bypass production controls.
3. **[Spend Management](https://vercel.com/docs/spend-management) and usage alerts** at 50%, 75%, and 100%, with an explicit monthly ceiling and the desired pause/webhook action.
4. Keep **Attack Challenge Mode** as the incident control for active abuse; do not leave it on as a dependency for normal on-chain recovery.

Status: Vercel platform DDoS mitigation is **DOCUMENTED/PLATFORM PROVIDED**. WAF rules, preview protection, project alerts, and spend ceiling are **MANUAL AND UNVERIFIED**. Cross-instance/alternate-URL rate-limit enforcement is therefore not yet evidenced from the repository.

### Launch blockers and residual risk

- Confirmed critical/high findings: **none**.
- Manual prerequisite: publish evidence that the four provider controls above are active. Until then, distributed identity rotation and alternate deployment URLs are **UNVERIFIED**.
- Medium deployed limitation: V2 zero-value dust can disable priced paths; direct in-kind recovery remains available. Any contract-level correction requires separate approval and a successor/migration plan.
- No live attack/load test was run by design. Capacity thresholds should be reviewed against real production telemetry after WAF log-only observation, then enforced before broad promotion.
