# HOODX V2 architecture — implementation specification

Status: development, not release-approved. Source baseline 8cba460. See V2_INVESTIGATION_CHECKPOINT.md and pinned discovery for evidence. No old contract is modified.

## Failure reconstruction

Deposit computes fees and pre-entry mint NAV, wraps gross ETH, transfers fees, establishes dead shares, warms observations, attempts target/replication buys through externally caught self-calls, credits min(NAV delta, net contribution), mints and snapshots prices. Oracle/token/fee-transfer/wrapping/snapshot failures revert the transaction. Caught buy failures preserve WETH through EVM rollback.

Withdrawal computes oracle-dependent NAV and proportional cash, invokes _liquidate, then burns requested shares and unwraps proceeds. _liquidate skips unsupported, unpriced, and reverted sells. HoodxSwap additionally RETURNS SUCCESS WITHOUT SELLING for zero liquidity or hooked V4. The caller has no authoritative balance-delta check. Quoted sells consume the entire vault quote balance and omit minWethOut enforcement. These permit successful withdrawals that leave proportional assets behind. minEthOut is also compared before the redemption fee rather than after it.

Rebalance uses owner swapV3 with a quoted floor and cash-floor check for buys, then snapshots. restoreCash is V3-only and permissionless. Both depend on pricing; quoted sell execution bypasses the composite min-out. Target edits consult NAV. Removal/rebinding require zero balances, so broken liquidation prevents repair. Stranding removes a held asset from enumeration and creates claims tied to remaining share balances. Pause blocks deposits and share transfers but not withdrawal; this does not remove its routing/oracle dependencies.

Every token balance/metadata/transfer/approval, oracle consult/observe, pool identity/liquidity query, router call, V4 callback settlement, WETH wrap/unwrap, fee payment and ETH receiver callback is an external failure boundary. V2 must not interpret failed or zero-effect sells as completed asset accounting. Pool membership/liquidity is not a promise of a sell path.

Historical scripts show repeated immutable implementations, external wallet loaders, clipped sells, AMZN/NFLX V4/USDG failures, whole-quote sweeps, stranding and curator-owned RescueTok liquidity extraction. These are historical evidence, not V2 deployment mechanisms.

## Chosen boundaries

- Vault: ERC20 accounting, fee roles, immutable policy/executor references, active balances and reserved shareholder claims. OpenZeppelin arithmetic, token handling, ERC20 and reentrancy protection. No asset-moving delegatecall; EIP-1167 cloning only delegates to the vault implementation.
- Policy: append-only approved asset configurations, independent oracle, buy/sell route hashes and explicit compatibility evidence. Permissionless factory creation selects approved configurations. Approval is an explicit trust boundary, not proof that liquidity will persist. No caller supplies arbitrary router calldata or a target.
- Executor: typed exact-input V3/V4 hops constructed into Universal Router 2.1.1 commands. Each hop is executed inside one reverting executor transaction; a later failed hop rolls back all earlier hops. It pulls only the authorized input, uses transient Permit2 allowances, fixes the recipient to itself then caller, measures actual deltas, and leaves pre-existing balances unchanged. Native V4 currency is normalized to WETH between hops. No partial fills, residual quotes, arbitrary recipients, arbitrary calls, or standing approvals.
- Oracle: independent valuation; initially only independently justified V3 TWAP references. V4 execution does not imply V4 spot valuation is safe. Insecure or unavailable references block public deposits, not in-kind redemption.

## Shares and exits

Normal ETH withdrawal sells every proportional constituent or reverts entirely. Actual output must meet the oracle-derived floor and user net minOut. Burn occurs only after liquidation accounting; a later ETH transfer failure reverts everything. Pausing cannot block either exit.

In-kind redemption creates exact per-token liabilities using current free balances and share fraction, before burning. It attempts independent transfers. A failed transfer retains the user's claim and excludes that reserve from all future NAV, swaps and redemptions; users can retry to another recipient. No router/oracle/curator dependency. The final shareholder receives all free asset dust. Token balanceOf correctness and eventual transferability remain unavoidable token assumptions; a blacklist cannot be overridden by HOODX. A broken balanceOf may still prevent a new snapshot; document this limitation and reject nonstandard tokens.

Use real shareholder supply for proportional exits, and virtual assets/shares only in mint conversion. High precision, required minShares, minimum first deposit, contribution-only credit and donation attack tests are release gates. Reservations survive a zero active supply and remain claimable. Donations when empty must not allow cheap capture of later deposits.

Constituents cannot be removed while free or reserved balances remain. Curator unwind only sells to vault WETH while paused. It cannot pay the curator. Creator economics and curator authority are separate initialization parameters and separate transfer domains.

## Release conditions

Discovery at block 67565367: old 696X and FAANGX have zero checked economic balances and zero live shares. Ten and five constituents respectively. Recheck before production. All nine supplied integration addresses have code, but code existence is not verified-source matching.

Official Universal Router tag 2.1.1 decodes six V3 exact-input fields, including uint256[] minHopPriceX36. Its v4-periphery revision is 3231810e39b8c4d569b9d66907fa4ef8cd2cec22. Pin ABI evidence and test real canonical router execution. Unknown/permissioned hooks remain unsupported until both-direction realistic/larger/failure tests pass.

Production remains disabled until all requested unit/fuzz/invariant/fork/static/frontend/canary gates pass. Same compiled bytecode for canary and production; production vaults empty; explicit long-term roles; named encrypted account and HOODX_LIVE_BROADCAST=1. No funding estimate may be invented before gas simulation and deployer public address exist.

## Current candidate status

The exact candidate route manifest is deployments/robinhood-4663-routing-v2.json. Pinned settings passed both normal official-basket round trips at latest tested block 67610605 and recorded stable block 67591644. Stress block 67565367 additionally demonstrates atomic normal-exit failure followed by successful direct redemption.

The original 0.04 ETH genesis share price, 0.02 ETH deposit minimum, 0.08 ETH first 696X deposit, exact live fees and metadata are preserved. Automatic claim attempts are individually capped at 150,000 gas; failed attempts leave liabilities intact for manual retry.

Some token implementations expose immutable infinite ERC20 allowance to Permit2. The executor detects this behavior instead of issuing an approval that those tokens reject; it still sets and revokes the exact separate Permit2 allowance to Universal Router. No configurable standing router allowance is introduced.

The seed policy and official factory initialize long-term roles during construction. Deployment scripts bind signing to the reviewed creation-bytecode/configuration fingerprint, require the live switch, and require receipt verification plus empty canary state before production. See the deployment report for the unsigned funding estimate and pending live steps.
