# HOODX Fee Machine security audit

Date: 2026-09-29
Scope: `HoodxFeeMachineLaunchV1`, `HoodxLiquidityControllerV1`, `HoodxLiquidityIndexV1`, `HoodxLiquiditySleeveV1`
Target: protocol-controlled Robinhood Chain pilot, no public deposit path

## Decision

No critical or high-severity issue was found in the reviewed pilot scope. Two medium-severity findings were found during review and fixed before launch:

1. Edge dwell originally followed spot price. A one-block manipulation could start or clear a re-band timer. Dwell now follows the pool TWAP; spot is only a divergence guard.
2. Pool checks originally ran only during construction. The one-time bootstrap now repeats exact pool, fee-protocol, lock-state, spot/TWAP, and launch-center checks immediately before any seed asset moves.

The contracts are suitable for an approximately $200 closed canary when every launch preflight passes. Public deposits, permissionless LP selection, and promotion as a public yield product remain outside this approval.

## Authority and invariants

- The deployer can create the immutable launcher but cannot fund it, receive FEEX, manage sleeves, or recover user assets.
- Only the official curator `0x134D468B0bcaeA6DF127916f951F7938c06A37C6` can perform the one-time bootstrap.
- The launcher fixes four pools, 30/30/30/10 weights, initial ranges, fee-protocol settings, the seed amount, and initial FEEX supply.
- The launcher activates the ownership graph in its constructor. No later acceptance race exists.
- After bootstrap, the launcher has no management authority. It only refunds its own residual WETH and paired-token dust to the curator during the atomic bootstrap.
- The controller owns the index and all sleeves. Its curator can collect, compound, pause, and perform policy-bounded re-bands. It cannot mint more FEEX or add new sleeve capital after bootstrap.
- FEEX holders can unwrap into four independent sleeve tokens. Each sleeve can then be redeemed directly for its two assets without a router, quote service, keeper, backend, or curator.
- Management fails closed when pool `feeProtocol` changes. Direct collection and redemption remain available.
- Unexpected tokens can be rescued only through curator methods on the controller. WETH, configured sleeve tokens, and each sleeve's two underlying assets cannot be rescued.

## Attack review

### Bootstrap and approval abuse

- Repeated bootstrap, wrong caller, wrong ETH amount, stale deadline, zero minimum, changed pool identity, changed fee protocol, locked pool, excessive spot/TWAP divergence, or movement away from the reviewed launch center all revert atomically.
- Every approval is exact and temporary. WETH and paired-token allowances are reset to zero after each use.
- The deployment transaction carries zero ETH. The curator sends the complete seed directly to the immutable launcher in one transaction.

### Price and re-band manipulation

- PONS sleeves use a one-hour TWAP, 500-tick spot/TWAP maximum, 24-hour edge dwell, seven-day cooldown, and a maximum 1,000-tick center move.
- The WETH/USDG core sleeve uses a 30-minute TWAP and a 120-tick divergence bound.
- Permissionless signalling cannot move assets or select a range. It records only a bounded TWAP edge observation.
- A spot-only move cannot start or clear dwell. Missed observation continuity resets rather than being assumed.
- The three PONS sleeves reject a re-band that follows the paired token downward. This prevents automatic averaging down into a collapse.

### Token and AMM behavior

- V1 does not accept arbitrary tokens. The launcher admits four exact pools and checks the exact factory, WETH side, fee tier, tick spacing, fee protocol, unlocked state, and nonzero liquidity.
- Current-fork tests exercised the exact DELTA, PONGO, GIWA, and USDG contracts through the canonical router and position manager.
- Deliberately adversarial ERC-20 behavior is not supported. A future permissionless LP factory needs token-behavior isolation, admission checks, and separate tests before release.
- Uniswap V3 factory, router, position manager, pool, WETH, and token contract bugs remain upstream risk. The pilot has no upgrade path that could silently replace them.

## GRIEFING READINESS

### Website, API, and RPC

- Public deposits are closed, so no unauthenticated API can trigger a seed or management operation.
- The on-chain recovery path has no website, CAPTCHA, RPC-provider policy, cache, image service, price API, or rate-limit dependency.
- Existing quote, cost-basis, market-data, and image endpoints remain governed by the site's bounded request handling. No Fee Machine endpoint was added for public quote fan-out.
- A backend or RPC outage stops previews and management. It does not unlock a permissive fallback and does not prevent direct holder recovery.
- Provider-level DDoS/WAF configuration is operational infrastructure and remains **UNVERIFIED** from repository evidence. It is not a dependency of contract recovery.

### Factory and listing spam

- The pilot has no public factory, metadata input, image URL, token list, or permissionless discovery event.
- The Explore entry is curated application data and is added only after receipt verification. Unknown LP indexes can still exist independently on chain in a future permissionless system; curated visibility must remain separate from contract access.
- Future user-created LP indexes must cap sleeve count, metadata size, RPC work per index, image origins, and indexing concurrency. Those controls are outside this closed pilot.

### Contract and withdrawal griefing

- Index unwrap is bounded to four sleeve transfers. A bad sleeve cannot stop redemption of another sleeve after unwrap because holders own each sleeve independently.
- Management pause blocks funding, harvest, compound, and re-band, while index unwrap and sleeve redemption remain callable.
- Dust and unsolicited constituent donations accrue pro rata. Unexpected assets can be rescued without touching constituents.
- One problematic pool cannot alter another sleeve's state. A reverting token can block only its own sleeve redemption; this exact-token pilot uses contracts exercised on the live-state fork.
- Failed mint, compound, or re-band transactions revert all state, leave the prior NFT intact, and permit a later retry.
- Maximum supported basket size is four in this launcher and eight in the generic controller constructor. The launched path executes exactly four sleeves.

### Final hook cooldown

The Fee Machine uses Uniswap V3 pools and does not install, schedule, reset, cancel, extend, or activate a hook. The earlier successor hook cooldown is unrelated to this pilot. No hook activation transaction is bypassed or included.

## Test evidence

- 1,024 fuzz runs prove proportional FEEX unwrap and independent sleeve recovery.
- Unit lifecycle, pause, fee collection, compounding, donation accounting, and unexpected-token recovery pass.
- TWAP divergence, dwell, cooldown, downside blocking, maximum movement, and missed-observation reset pass.
- Fee-protocol drift blocks management while collection and direct recovery remain available.
- Current Robinhood fork: all four exact sleeves mint and recover through the canonical manager.
- Current Robinhood fork: complete atomic deploy, protected swaps, bootstrap, pause, full unwrap, and independent recovery pass.
- Bootstrap revalidation rejects market drift after deployment; unauthorized and repeated bootstrap calls reject.
- Final compiled sizes are below EIP-170 and EIP-3860 limits. Launcher runtime is 7,070 bytes and initcode is 44,695 bytes.

## Residual risks and launch conditions

- This is a closed canary with approximately $200 and no public deposit path.
- The three PONS assets are highly volatile. A single token can impair roughly 30% of seed NAV; all three can impair roughly 90%.
- Historical performance is short and cannot establish a stable expected return.
- Launch must wait if any spot/TWAP, identity, fee-protocol, liquidity, balance, bytecode, gas-cap, or full-call simulation check fails.
- The exact post-deployment bootstrap transaction must be simulated against current state immediately before it is shown in Brave.
- Provider WAF settings and adversarial arbitrary-token support remain **UNVERIFIED** and are not represented as pilot protections.
