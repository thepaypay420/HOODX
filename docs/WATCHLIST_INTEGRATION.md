# Complete 696 watchlist integration checkpoint

Scope: support the 20-name user watchlist through validated token configurations, retaining current slippage, liquidity, accounting and withdrawal protections. No live configuration change is authorized by a discovery result.

## Confirmed deployment constraints

- HoodxIndexV2 pins policy and executor immutably. The current executor accepts only V3/V4 route kinds and constructor-approved hooks. No method adds hooks or swaps out the executor.
- HoodxPolicyV2 allows its owner to approve additional token/oracle/route configurations. New oracle implementations can therefore support compatible execution routes without migrating vault assets.
- Policy owner read at block 68571589: 0x134D468B0bcaeA6DF127916f951F7938c06A37C6. Ordinary curators can select approved configurations, but cannot approve arbitrary new configurations themselves.
- V2-only execution or a previously unapproved V4 hook cannot be enabled by a frontend edit or oracle change.

## Discovery status

`scripts/survey_watchlist.mjs` is read-only and writes a pinned-block discovery report. It checks token metadata, canonical V3 pools and 30-minute observation availability, and indexed V4 pool keys, identity hashes, liquidity and deployed hook approval. Candidate status does not certify economic depth, composite quote bridges, protected outputs, tax behavior, or complete vault round trips.

The public RPC began returning HTTP 403 during the run. `deployments/696x-compatibility-discovery.json` is explicitly incomplete and MUST NOT be used to approve an asset. No asset has passed a fresh complete fork rehearsal in this checkpoint.

`deployments/696x-market-discovery.json` contains current public listings for the 20 addresses, not on-chain compatibility evidence. QUOTIENT's existing universe address returned no listings. ZEAL and Aria are exact-name listing candidates requiring identity confirmation. PRISM is the address previously supplied by the user.

## Required continuation

1. Restore private RPC through the existing private configuration, without displaying it. Confirm all 20 identities and rerun complete pinned-state discovery.
2. Evaluate economically defensible references and quote bridges. Use existing V3 TWAP where justified; evaluate separately reviewed cumulative-price oracle support for candidates such as PRISM. Never substitute DEX display prices or V4 instantaneous spot as authoritative share valuation.
3. Run actual protected buy/sell, partial/final withdrawal, in-kind exit and residual-balance fork tests for each candidate at meaningful sizes, then a full 20-asset basket gas/economic rehearsal. Independent quoter calls are not sequential round trips.
4. Prepare owner-reviewed oracle deployments/config approvals only for passing assets. Expose approved additions to curators. For assets requiring unsupported immutable execution paths, present the concrete upgrade/migration implication before changing live assets.

No live transactions, policy approvals, new oracle deployments, basket changes or production frontend changes were made by this checkpoint.
