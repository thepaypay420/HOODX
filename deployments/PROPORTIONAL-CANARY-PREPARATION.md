# Successor canary admission checkpoint

Prepared 2026-09-23 for Robinhood Chain 4663. This checkpoint does not activate hooks, approve live routes, create a live vault, or move capital.

## Pinned 20-asset manifest

- Route fingerprint: `0x413f8092b14d21cd87e2db8b7b9c05b437ce468a2ab04aa228f5f0a03592b4d8`
- Admission evidence: `keccak256("HOODX_696X_WATCHLIST_ROUTE_REVIEW_V1_2026-09-23")`
- Asset count: 20
- Cash target: 25%; each asset target: 3.75%
- USDG bridge: Uniswap V3 0.01% (`100`)
- SPY bridge: Uniswap V3 0.05% (`500`)
- SPCX bridge: Uniswap V3 0.05% (`500`)

The route manifest is defined once in `script/ProportionalWatchlistV3.sol` and imported by both the live-stage scripts and the fork lifecycle tests. Bridge selection is pinned; no live signing script searches for a different pool or fee tier.

## Stage separation

1. `ActivateProportionalHooksV3.s.sol`, stage `successor-canary-hooks`: activates only the two existing delayed proposals after checking the exact ready timestamp, proposal evidence and hook code hashes.
2. `ApproveProportionalWatchlistV3.s.sol`, stage `successor-canary-routes`: approves only the exact 20-route fingerprint. It cannot create or fund a vault.
3. `CreateProportionalCanaryV3.s.sol`, stage `successor-canary-create`: reads back every approved route and creates only the empty `696xcanary` clone. It cannot bootstrap or move canary capital.

Each broadcast stage still requires `HOODX_LIVE_BROADCAST=1` and a new concrete gas and fee review. The route and create stages additionally require `HOODX_REVIEWED_ROUTES` to equal the pinned fingerprint.

## Verification completed

- Full non-fork Foundry suite passes after the manifest and stage scripts were added.
- Manifest integrity test proves 20 unique tokens and complete WETH/native-to-token and token-to-WETH/native round trips.
- Current-state 20-asset lifecycle passed at 0.02 ETH on block 70354797, 0.08 ETH on block 70356086 and 0.5 ETH on block 70356993.
- Exact deployed-infrastructure rehearsal passed from block 70360821. On the disposable fork it activated both hooks after advancing fork time, admitted all 20 routes, created `696xcanary`, completed bootstrap, second-user join, partial ETH exit, paused in-kind recovery and final ETH exit, verified zero free constituent/WETH balances, and created a separate user-owned future vault from admitted route IDs.

Future user-created vaults are permissionless at the factory and may select any route IDs already admitted by the policy. A new token still requires the same qualification, buy/sell rehearsal, code-hash pinning and owner admission before a user vault can select it; this prevents an arbitrary malicious token from entering other users' baskets.

## Live boundary

The two hook proposals cannot be activated before Unix timestamp `1790322086`: 2026-09-25 07:41:26 UTC / 00:41:26 Pacific. After maturity, refresh hook code and dependencies, current-fork lifecycle, deployer nonce/balance, gas price and the per-stage maximum fee immediately before each signing request. Production remains stopped until the live canary is fully recovered and verified.
