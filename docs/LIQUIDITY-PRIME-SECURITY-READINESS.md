# Liquidity Prime security readiness

Date: 2026-09-28
Scope: `HoodxLiquiditySleeveV1`, `HoodxLiquidityIndexV1`, `HoodxLiquidityControllerV1`
Production state changed: **No**

## Launch decision

The contracts are ready for continued local/fork testing and an empty canary review. They are **not approved for a funded public launch** yet. V1 intentionally omits public deposits, WETH swaps, dynamic weight restoration, arbitrary pool creation, and upgrades. Those omissions remove unproven accounting and routing risk from the protocol-controlled pilot.

## Authority and custody

- The official curator controls management through one immutable controller.
- Pool, factory, position manager, fee tier, token pair, range width, TWAP window, edge buffer, dwell, cooldown, divergence limit, and maximum center movement are fixed at deployment.
- The curator can seed each sleeve only before the index is bootstrapped.
- The curator can collect fees, compound pair balances, re-band within policy, and pause management.
- The curator cannot mint index shares after bootstrap, withdraw the index WETH reserve, rescue constituent sleeve shares, rescue sleeve pair tokens, alter policy, replace pools, or bypass the re-band checks.
- Holder recovery does not call a router, oracle, API, cache, keeper, or curator.

## Failure behavior

| Failure | Result |
| --- | --- |
| Management paused | Funding, harvest, compound and re-band stop; index unwrap and sleeve redemption remain available. |
| RPC/keeper outage | Edge observations stop; after 30 minutes the dwell timer is stale and restarts. No unrestricted fallback. |
| Spot/TWAP divergence | Signalling and execution reject the move. |
| Stale deadline | Funding, compound, re-band and redemption revert. Maximum window is five minutes. |
| Bad re-band minimum | The complete transaction reverts, restoring the old NFT and balances. |
| One underlying token reverts | That sleeve redemption can fail, but the user already holds every other sleeve independently after index unwrap. |
| Unsolicited pair-token donation | It remains in the sleeve and accrues pro rata to sleeve-share holders. |
| Unsolicited WETH donation | It accrues pro rata to index holders. |
| Attempted post-bootstrap funding | Controller rejects it to prevent holder dilution. |
| Missed edge observation | Dwell restarts; the controller does not assume continuity. |

## Griefing readiness

- `signal` is permissionless so a protocol keeper is not a liveness monopoly. It performs bounded reads against one immutable pool and writes two fixed storage slots.
- Repeated signals cannot move funds, change policy, shorten dwell, bypass cooldown, or select a different range. Calls during a valid edge condition preserve the original start time; a normal-range observation clears it.
- A third party cannot make a valid unsafe observation: spot and TWAP come from the immutable reviewed pool and must remain within the fixed divergence bound.
- Keeper or RPC failure is fail-closed. There is no backend switch that turns management limits off.
- There is no public LP factory or permissionless listing in V1, so metadata, fake-name, oversized-basket, and mass-deployment spam are outside this pilot. The later permissionless factory must keep on-chain creation separate from curated Explore visibility.
- Recovery performs bounded work: the parent index transfers at most four sleeve tokens and WETH; each sleeve owns one active NFT.
- Website rate limiting, quote caching, and market-data availability do not sit on the recovery path.

## Test evidence

- 1,024 fuzz cases: arbitrary partial index unwrap plus sleeve redemption preserves exact proportional recovery.
- 1,024 fuzz cases: a donation cannot increase shares minted by the accounting model.
- Unit lifecycle: activation, one-time seed, bootstrap, post-bootstrap funding rejection, pause, unwrap and pair-token redemption.
- Unit management: fee collection and compound increase liquidity without minting shares.
- Unit automation: TWAP divergence, dwell, cooldown, maximum movement, and missed-observation reset.
- Current-state Robinhood fork: all four reviewed pools mint and burn positions through canonical position manager `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`.
- Current-state Robinhood fork: complete four-sleeve index bootstrap, unwrap, and independent recovery passed in one test; measured test gas was `6,968,640` under the fork harness.
- Robinhood block `74,572,742`: all five researched pools matched the reviewed factory, pair, fee tier, tick spacing, initialized price, unlocked state, and nonzero liquidity.
- No-broadcast four-sleeve deployment rehearsal completed on chain ID 4663; estimated deployment requirement was approximately `0.000724 ETH` at the observed gas price.
- Web: 97 tests passed, TypeScript passed, static production build passed with Node 24 and webpack.

## Remaining launch blockers

1. Independent Solidity security review is still **UNVERIFIED**.
2. A fully pinned historical mint/re-band/redeem lifecycle is **UNVERIFIED** because the public RPC does not serve arbitrary-account history at the review block. Current-state lifecycle and pinned read-only identity checks passed separately.
3. Failure-injection tests with deliberately reverting and gas-heavy underlying tokens are **UNVERIFIED**. V1 admits only the four exact reviewed pools, but these tests should still be added before funding.
4. Economic seed sizing, seven-day and 30-day net return, inactive-range time, impermanent loss, and re-band cost remain **UNVERIFIED**.
5. SPY `uiMultiplier()` and independent price accounting remain blockers for any future NAV-based public deposit or WETH exit. V1 does not perform either operation.
6. The protected swap adapter required for cross-sleeve weight restoration is not implemented. It must bind the exact pool, direction, amount, TWAP floor, reserve floor, nonce, and deadline.

No critical/high vulnerability was found in the implemented narrow pilot scope. A funded launch remains blocked by the items above.
