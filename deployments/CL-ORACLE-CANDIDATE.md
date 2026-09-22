# Concentrated-liquidity reference adapter — candidate only

`HoodxClTwapV3` adds a separate historical reference interface for fixed-implementation CL pools. It does not change the live V2 vaults, accept V4 spot prices as NAV, or change execution tolerances. It composes the token/quote TWAP with a separately reviewed quote/ETH oracle.

## Why this was needed

NET's active USDG pool at `0x99e70A5b06215e5D2F3BeC773b4f59c008fc1673` has price history, but its factory indexes pools by signed tick spacing rather than Uniswap V3's unsigned fee tier. Its slot0 return layout also differs. The standard V3 discovery scan therefore did not qualify this source.

The candidate factory is `0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3`. Factory membership and spacing lookup both match. The pool runtime is an exact EIP-1167 clone of `0x11725976BF1F38c4aB78d1F480bc5883d70D9dc3`. Verified implementation source exposes the expected tick cumulative and seconds-per-liquidity observation functions. Source identity alone is not an independent audit or approval of the venue.

Verified source metadata:
- https://sourcify.dev/server/v2/contract/4663/0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3?fields=abi,compilation
- https://sourcify.dev/server/v2/contract/4663/0x11725976BF1F38c4aB78d1F480bc5883d70D9dc3?fields=abi,compilation,sources

## Guards and limits

- Minimum 30-minute history; freshness no longer than the averaging window.
- Both current and harmonic historical liquidity must satisfy a fixed configured minimum.
- Exact clone runtime and implementation code hashes are pinned. Quote adapter code is also pinned; it must itself enforce the integrity of its dependencies.
- Factory membership, token pair and tick spacing are checked at construction.
- Missing history, stale observation, bad asset, changed code, failed quote conversion or zero nonzero-amount valuation rejects the request.
- Recency is not proof of trading, and harmonic liquidity is not a complete economic manipulation-cost analysis. These still need qualification.

NET fork tests use a fixed diagnostic minimum of 2118471187028, the harmonic observation at block 69383632. The USDG/ETH bridge retains the prior pinned minimum 2631289198634062971. Neither value is dynamically lowered when a test fails.

At block 69386411, NET's protected V4 round trips passed for 0.0001, 0.001 and 0.005 ETH using this separate historical reference. This is execution evidence, not approval to deploy or list a token. No successor was deployed.

## Market-dependent failures and final recheck

ZEAL's V4 route failed its buy minimum at block 69381611. Its alternative canonical V3 route also failed at block 69383246. At 0.005 ETH, V3 expected executable output was 2987812260671972021306 raw units against protected minimum 2988437739195068760954. The floor was preserved. Existing ZEAL failure tests remain present rather than being replaced by the NET tests.

At block **69394631**, all nine PRISM/ZEAL route tests and both PRISM/ZEAL vault lifecycle tests passed. The previous ZEAL mismatch had resolved on that state without changing a minimum. Both NET basket tests failed closed: NET reference live liquidity was 1726943999685 and harmonic liquidity 1913024003913, both below the fixed 2118471187028 minimum. Source age was 15 seconds. The USDG/ETH bridge passed its depth and freshness checks. See `net-reference-diagnosis.json`. This is a current release blocker, not a passing NET release.

Aria and PROMETHEUS still have no usable discovered historical reference. HARMONIC has active alternative V3 pools but insufficient history in the ones checked. Its newly discovered CL pool has zero active liquidity. QUOTRON's canonical V2 pair is stale and has only 0.000013710288986955 WETH at block 69389159; it is not a credible valuation replacement.

## Vault claim correction and validation

The fork exposed a gas-budget issue in the successor's automatic PRISM claim: loading complete policy routes inside the 150,000-gas attempt exhausted its allowance. The claim remained reserved and a separate owner claim succeeded, but that unnecessarily required another transaction.

The undeployed V3 vault now caches the **pure configured transfer factor** on constituent addition and configuration replacement, clearing it on removal. Dynamic swap fees remain live reads. This removes the expensive route load from the claim path without increasing the gas allowance or lowering the recipient's minimum. A regression changes the configured tax limit, confirms excessive tax still leaves a reserved claim, restores the approved configuration and recovers it.

Final local run: **66 tests passed**, including 15 CL adapter safety tests, three 1,024-run fuzz tests, and 128 invariant runs / 8,192 calls with zero handler reverts. Compilation succeeded. Runtime sizes: V3 vault 21,752 bytes; CL oracle 4,996 bytes (both below 24,576).

The claim correction was replayed at the original block **69390039**: both PRISM/NET lifecycle tests passed, including automatic PRISM payment while paused with stale prices, full residual-balance checks, and two-user partial/final ETH withdrawals. This pinned regression proves the fix; it does not override the newer NET liquidity rejection.

No live vault change, deployment, token trade or maintenance transaction was broadcast for this work. Full 20-token qualification and canaries remain blocked by the unresolved references and economic-source review.
