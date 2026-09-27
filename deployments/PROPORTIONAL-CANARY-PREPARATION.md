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

## Live canary checkpoint

The two reviewed hooks were activated after their full cooldown, all 21 reviewed routes were admitted, and the empty `696xcanary` clone was created at `0x64C9cBBa19B6f6A6D9646b0694F668BeA2501436`.

The guarded 0.02 ETH bootstrap completed in transaction `0xcc968c7b88c2fb5c283eb319f2d2eae0e5fede1f79d117e5ea38c36d9c966c80` at block `73738243`. The post-state verifier recorded 41 confirmations at block `73738283`, positive holdings for all 21 constituents, a positive WETH reserve, `0.4975` canary shares held entirely by the deployer, zero curator shares, zero deferred deployer/curator claims and no native ETH held by the vault. The machine-readable evidence is in `proportional-canary-bootstrap-verification.json`.

This completes only the first guarded capital stage. The participant join, partial ETH exit, paused in-kind recovery and final deployer close remain pending and require their own fresh rehearsals, fee envelopes and explicit authorizations. The public successor release manifest remains inactive until the complete canary lifecycle is recovered and verified.
