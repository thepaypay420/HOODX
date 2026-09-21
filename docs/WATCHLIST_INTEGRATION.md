# Complete 696 watchlist integration checkpoint

Scope: support the 20-name user watchlist through validated token configurations, retaining current slippage, liquidity, accounting and withdrawal protections. No live configuration change is authorized by a discovery result.

## Confirmed deployment constraints

- HoodxIndexV2 pins policy and executor immutably. The current executor accepts only V3/V4 route kinds and constructor-approved hooks. No method adds hooks or swaps out the executor.
- HoodxPolicyV2 allows its owner to approve additional token/oracle/route configurations. New oracle implementations can therefore support compatible execution routes without migrating vault assets.
- Policy owner read at block 68571589: 0x134D468B0bcaeA6DF127916f951F7938c06A37C6. Ordinary curators can select approved configurations, but cannot approve arbitrary new configurations themselves.
- V2-only execution or a previously unapproved V4 hook cannot be enabled by a frontend edit or oracle change.

## Completed private-RPC discovery and fork results

Private RPC was loaded from the user-designated local file into process memory only. No endpoint or signing secret was written to reports. Chain ID 4663, block 68574692. All 20 token-address discovery records completed without per-asset errors.

14 addresses have an active V3 30-minute-history candidate. Candidate availability does not establish adequate economic depth or correct watchlist identity. The six without a candidate are PRISM, NET, ZEAL, Aria, HARMONIC and PROMETHEUS. ZEAL's V3 observation cardinality and next cardinality were both 1 at follow-up read: history expansion and accumulation would be needed before valuation use.

42 sequential buy-then-sell tests exercised the actual deployed executor at 0.0001, 0.001 and 0.005 ETH with 97% oracle floors. 36 passed: PONS, AI, CASHCAT, Index, MEME, STONKBROKER, HOOKR, DELTA, BOW, UP, website and QUOTIENT each passed three sizes. Executor input/output balances returned to their initial values and test-holder token balances were zero after successful sells. These are route tests, not full-vault deposit/share accounting or final liquidity-depth approval.

6 direct-route tests failed: QUOTRON failed token transfer (TF) at all sizes; SHROOM failed InvalidAmount at all sizes. In the 0.0001 ETH SHROOM case the sale produced 0.000098010001848151 ETH versus a protected minimum of 0.000099065572193044 ETH. This is a protected failure, not a reason to reduce the minimum.

A further three sequential tests used SHROOM's deeper hookless V4/USDG route via the canonical V3 USDG bridge with the same oracle and floor. All three failed InvalidAmount. Total completed final route checks: 36 passed, 9 failed; diagnostic reruns of two cases are not additional unique cases.

The initial Python-relay fork attempts had upstream transport failures. Their revert reports are invalid economic results and are superseded by the successful-transport Node relay runs. The historical full-stack 696X rehearsal was interrupted by those transport errors and has not been certified by this checkpoint.

## Outstanding compatibility work

- PRISM and NET: evaluate cumulative V2 reference-oracle support plus existing compatible V4 execution. No new oracle deployed. Liquidity-history and manipulation assumptions require review; observations reconstructed off-chain are not an on-chain oracle.
- ZEAL: V3 price-history capacity is insufficient. Its deepest V4 pool uses an unsupported hook; compatible alternatives have high fees. Neither changing cardinality nor a quoter success alone certifies safe support.
- Aria, HARMONIC, PROMETHEUS: no discovered eligible V3 reference. Their main indexed pools use hook 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044, which the deployed executor rejects. Smaller hookless alternatives do not solve valuation and may be uneconomic.
- QUOTRON: direct V3 transfer failure. Main indexed V4 pool uses unsupported hook 0x62E200Cc8e4D95cf622f40Dd70f407C883EcB0cc. Diagnose token restrictions/identity before any proposed inclusion.
- SHROOM: repeat protected route work as price history evolves or identify a defensible different reference/route. Preserve minimum-output protections.
- QUOTIENT, ZEAL and Aria identities still need curator confirmation: the first comes from an older saved universe with no current indexed listings; the latter two were resolved from exact-name public listings. Token symbols are not identity proofs.

## Next decision and release gates

The current executor cannot be upgraded in place. Full coverage of the identified unsupported hooks requires an opt-in successor executor/vault or genuinely compatible alternative pools; an oracle or frontend change cannot remove that restriction. User asked to choose successor development versus existing-vault-only compatibility. No live asset movement is implied.

After choosing scope: review the new oracle/execution trust model, test hook behavior and transfer restrictions, run full-vault partial/final and in-kind exits, gas/economic tests for the complete basket, then prepare explicit configuration/deployment transactions. All liquidity and minimum-output safeguards remain in force.

No live transactions, policy approvals, oracle deployments, basket changes or production frontend changes were made in this work.
