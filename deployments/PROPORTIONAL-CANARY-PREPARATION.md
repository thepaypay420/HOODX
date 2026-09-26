# Successor canary admission checkpoint

Refreshed 2026-09-26 for Robinhood Chain 4663. This checkpoint does not activate hooks, approve live routes, create a live vault, or move capital.

## Pinned 21-asset manifest

- Route fingerprint: `0x6e099c7bc199851686bca108bde88de3f20531e953352a4102712ef1ca03b93a`
- Admission evidence: `keccak256("HOODX_696X_WATCHLIST_ROUTE_REVIEW_V2_2026-09-26")`
- Asset count: 21
- Assets: PONS, AI, CASHCAT, Index, MEME, STONKBROKER, PRISM, HOOKR, DELTA, SHROOM, BOW, UP, QUOTRON, NET, ZEAL, musebook, Aria, HARMONIC, QUOTIENT, PROMETHEUS, STELX.
- Cash target: 25%; PONS, AI and CASHCAT target 3.58% each; the other 18 assets target 3.57% each. Asset weights total exactly 75%.
- USDG bridge: Uniswap V3 0.01% (`100`)
- SPY bridge: Uniswap V3 0.05% (`500`)
- SPCX bridge: Uniswap V3 0.05% (`500`)

The route manifest is defined once in `script/ProportionalWatchlistV3.sol` and imported by both the live-stage scripts and the fork lifecycle tests. Bridge selection is pinned; no live signing script searches for a different pool or fee tier.

## Stage separation

1. `ActivateProportionalHooksV3.s.sol`, stage `successor-canary-hooks`: activates only the two existing delayed proposals after checking the exact ready timestamp, proposal evidence and hook code hashes.
2. `ApproveProportionalWatchlistV3.s.sol`, stage `successor-canary-routes`: approves only the exact 21-route fingerprint through the live curator-owned route administrator. Its on-chain batch cap produces one 20-route call and one 1-route call. It cannot create or fund a vault.
3. `CreateProportionalCanaryV3.s.sol`, stage `successor-canary-create`: reads back every approved route and creates only the empty `696xcanary` clone. It cannot bootstrap or move canary capital.

Each broadcast stage still requires `HOODX_LIVE_BROADCAST=1` and a new concrete gas and fee review. The route and create stages additionally require `HOODX_REVIEWED_ROUTES` to equal the pinned fingerprint.

## Verification completed

- Full optimized Foundry build passes after the 21-asset manifest and current route-administrator signing path were added.
- Manifest integrity proves 21 unique tokens, complete WETH/native-to-token and token-to-WETH/native round trips, and an exact 7,500-basis-point asset total.
- Isolated protected round trips for musebook and STELX passed at 0.0001, 0.001 and 0.005 ETH per route on block 72943478.
- Current-state 21-asset lifecycle passed at 0.02 ETH on block 72940538, 0.08 ETH on block 72942662 and 0.5 ETH on block 72943478.
- Exact deployed-infrastructure rehearsal passed from block 72943478. On the disposable fork it activated the two matured hooks as the registry owner, admitted the 21 routes in two bounded calls through route administrator `0x49bAe4Eb7b7a7567f67A600Ca8752027e9d12Fa3`, created `696xcanary`, completed bootstrap, second-user join, partial ETH exit, paused in-kind recovery and final ETH exit, verified zero free constituent/WETH balances, and created a separate user-owned future vault from admitted route IDs.

Future user-created vaults are permissionless at the factory and may select any route IDs already admitted by the policy. A new token still requires the same qualification, buy/sell rehearsal, code-hash pinning and owner admission before a user vault can select it; this prevents an arbitrary malicious token from entering other users' baskets.

## Live boundary

The two hook proposals matured at Unix timestamp `1790322086`: 2026-09-25 07:41:26 UTC / 00:41:26 Pacific. Read-only verification on 2026-09-26 confirmed both pending proposals still point to the reviewed code hashes and neither is active. Immediately before each signing request, refresh hook code and dependencies, current-fork lifecycle, signer nonces/balances, gas price and per-stage maximum fees. Production remains stopped until the live canary is fully recovered and verified.
