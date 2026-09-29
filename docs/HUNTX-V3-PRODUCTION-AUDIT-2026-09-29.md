# HUNTX V3 production audit — 2026-09-29

## Decision

The code and launch tooling are ready for a closed $200 pilot. Production deployment and seeding are **blocked by wallet funding and the current GIWA spot/TWAP stability gate**, not by a known critical or high code finding. The latest live preflight requires about 0.0744 ETH plus gas across both layers; the official curator wallet is short about 0.0505 ETH. GIWA was 739 ticks from its TWAP at block 75,962,485, beyond the reviewed limit, so deployment correctly fails closed until the market settles.

No production transaction was broadcast during this review.

## Reviewed construction

- 80%: one fully backed FEEX token holding four programmatic concentrated-liquidity sleeves (DELTA/WETH 30%, PONGO/WETH 30%, GIWA/WETH 30%, USDG/WETH 10%).
- 20%: immutable HUNTX WETH working sleeve.
- Genesis: 160 FEEX + the exact WETH working amount must arrive atomically before 200 HUNTX can mint.
- Risk: two fixed 10% probes maximum, two entries per day, 30-minute spacing, 12-hour observation, 48-hour admission expiry.
- Exit: +50% take profit, -20% stop, or four-hour timeout. Anyone may enforce a triggered exit; the caller cannot weaken the 97% oracle floor.
- Recovery: HUNTX burns into FEEX, WETH, and any active launch assets independently. FEEX can then unwrap into the four sleeve shares; a failing asset cannot block unrelated claims.

## Security and economic findings

No unresolved critical or high finding was identified in the reviewed closed-pilot scope.

- **Atomic backing:** fixed by pulling the exact manifest-backed FEEX amount inside `bootstrap`; short or fee-on-transfer delivery reverts before minting.
- **Authority:** deployment pins the official curator, reviewed executor runtime hash, registry, WETH, approved PONS hook, base runtime hash, base controller, four non-empty sleeves, and exact genesis supply.
- **Deployment provenance:** funding manifests are created only from a successful deployer contract-creation receipt whose sender, nonce-derived address, and full init-data hash match the fresh preflight. Wallet helpers recheck recorded runtime hashes before presenting a signature.
- **Donations and dust:** donations cannot increase the immutable risk reference or absolute probe size. Base/WETH donations accrue to holders; unsolicited candidate-token donations are excluded from valuation, exits, and claims. Other unexpected tokens can be rescued only when they are not base, WETH, candidates, or reserved claims.
- **Route and token change:** append-only route IDs, token runtime hash pinning, live route validation, oracle value checks, and admission expiry fail closed.
- **Griefing:** public exit exists only after a hard trigger and always retains the independent execution floor. A reverting or gas-heavy token defers only its claim; other assets remain recoverable. Failed exits retain active state and can be retried.
- **Candidate-token behavior changes:** exact internally tracked receipts drive valuation, exit sizing, and redemption. A later-reverting `balanceOf` cannot hold FEEX or WETH hostage; donations cannot fabricate a take-profit; partial redemption scales the remaining cost basis.
- **LP management:** rebands require dwell, cooldown, TWAP agreement, and fresh market validation. Fee-protocol changes block management while preserving recovery.
- **Operational failure:** RPC failure, stale manifests, changed deployment terms, insufficient balances, failed simulation, or failed receipt verification stop the scripts. There is no automatic broadcast or automatic retry.

## Verification evidence

- Launch unit and griefing paths: 39 pass, including malicious `balanceOf`, donation-trigger, partial-redemption cost basis, atomic backing, and retry cases; one opt-in legacy fork test is skipped by default.
- Full non-fork repository suite: 305 tests pass with zero failures.
- Invariants: conservation, claim backing, and cleared allowances run for 8,192 calls per invariant suite.
- Contract size: HUNTX runtime 17,142 bytes, leaving 7,434 bytes below the EIP-170 limit. Launcher init code 27,892 bytes.
- Live read-only pool check at block 75,962,485: DELTA, PONGO, and USDG passed; GIWA was 739 ticks from TWAP and correctly blocked deployment. The preceding block-75,942,583 snapshot had all four pools within bounds and was used for the successful fork rehearsal.
- Bounded local fork: FEEX deployment, four-sleeve funding, HUNTX atomic seed, in-kind HUNTX recovery, and retained FEEX recovery are exercised without production broadcasts.

## GRIEFING READINESS

| Attack | Prerequisite / reproduction | Impact | Protection and result |
|---|---|---|---|
| Partial or malicious genesis backing | Short FEEX balance/allowance or non-exact transfer | Underback HUNTX | Exact before/after balance delta; whole bootstrap reverts; tested PASS |
| Donation expands launch risk | Send WETH directly before trading | Larger speculative positions | Immutable risk reference and fixed 10% sizing; tested PASS |
| Candidate donation fabricates profit | Donate the active launch token at unchanged price | Premature permissionless exit | Internally tracked receipts drive value and sell size; tested PASS |
| Partial redemption fabricates stop | Redeem 20% while a probe is open | Remaining position appears 20% down | Entry cost scales with the reserved tactical amount; tested PASS |
| Bad launch token blocks all recovery | Token transfer reverts or burns gas | Holder withdrawal denial | Per-token reservation and 150k-gas isolated claim; unrelated assets pay; tested PASS |
| Exit caller supplies weak minimum | Call permissionless exit with zero minimum | Value extraction through slippage | Contract derives and enforces 97% oracle floor; tested PASS |
| Failed route leaves stuck state | Router/oracle/liquidity failure at exit | Cannot retry | State changes roll back; position stays active and retryable; tested PASS |
| Rapid churn | Repeated arm/enter/exit | Gas and fee bleed | 12h observation, two entries/day, 30m spacing, 48h expiry; tested PASS |
| LP price manipulation | Move spot briefly before seed/reband | Bad range or valuation | TWAP agreement and funding-time revalidation; fork tested PASS |
| Shared-asset failure | One sleeve or token fails | Blocks all exits | HUNTX returns FEEX independently; FEEX returns sleeve shares; direct recovery is separate; fork tested PASS |
| RPC/cache outage | Upstream unavailable or returns 502 | Unsafe stale launch | Bounded timeout/retry and fail-closed preflight/signer; tested by observed 502 failure PASS |
| Public/API cost amplification | Repeated public quote requests | Infrastructure cost | HUNTX has no public deposit/quote endpoint in this closed pilot. Broader site protections remain covered by the platform griefing review, outside this contract-only delta. |

## Remaining manual gates

1. Fund the official curator wallet with at least the reported shortfall plus a small gas margin.
2. Wait for GIWA spot/TWAP stability, then refresh both preflights; pool state and gas estimates are intentionally not reusable.
3. Execute each deployer and curator signature in runbook order and verify every receipt before the next.
4. Keep HUNTX out of public discovery until `huntx-v3-live.json` verifies full backing.

APR remains **unverified** and must not be marketed as guaranteed. Historical candidate samples and LP fee studies are research evidence, not a forward return promise. The closed pilot is designed to produce live net-of-gas data before public access.
