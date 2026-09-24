# ETH-only proportional accounting research

Status: isolated test harness, NOT deployable production code. Existing vaults and successor contracts are unchanged. User approved exploring this model on 2026-09-22 after previously choosing to wait for independent prices.

## Why this is different

Uniswap v4 core does not include the historical oracle built into v2/v3. A hook is fixed in the pool key at initialization; an oracle hook cannot be attached to the existing trading pools. The currently used Pons hook exposes fee settings, not cumulative price observations. Swap quotes alone do not resolve manipulation of price-based share issuance.

References reviewed:
- https://app.uniswap.org/whitepaper-v4.pdf
- https://developers.uniswap.org/docs/protocols/v4/concepts/hooks
- https://blog.uniswap.org/uniswap-v4-truncated-oracle-hook
- https://developers.uniswap.org/docs/protocols/v2/concepts/pricing
- https://developers.uniswap.org/docs/protocols/v2/guides/building-an-oracle

## Exact-share ETH join

For existing supply S, requested new shares M, and each existing token balance B, require an actual contribution of ceil(B * M / S). Include the WETH cash reserve. The incoming user supplies ETH and explicit per-route budgets. Mint exactly M only after every final token balance satisfies the requirement. Refund unused ETH beyond the proportional cash contribution. The old holder's token entitlement cannot decrease: (B + contribution)/(S + M) >= B/S.

The experiment snapshots all balances before swaps and checks all balances again after all swaps. It rejects partial purchases, spending existing cash, and excessive sender debits. It counts actual received balances rather than executor return values. This establishes a token-quantity property, not a guarantee against market losses, malicious rebases, or changes in token behavior.

The UI would quote a share amount affordable for the user's ETH budget. Shares and maximum ETH spend are fixed in the signed transaction. A changed basket or donation may cause a revert requiring a new quote; it must not silently reduce shares. Output above the contribution requirement is donated to the basket in this prototype. Production must bound and disclose this surplus or implement a tax-aware surplus refund without breaking the backing invariant.

## ETH exit experiment

Sell only the withdrawing holder's proportional token quantities, retain remaining holders' balances, enforce a positive minimum for each executed sale plus an aggregate ETH minimum, then burn shares and pay ETH. Final exit consumes the basket. Failed routes revert the entire transaction. These quote-based exit floors belong to the user's signed order; they are not a replacement NAV oracle or an automatic relaxation of existing production policy.

## Deliberate exclusions / release gates

- Test-only seedShares is unrestricted fixture setup and must NEVER be deployed as a production bootstrap API.
- No curator rebalancing, target-weight changes, adding/removing assets, fees, reserved claims, in-kind fallback, native-ETH donations or production policy integration are implemented here.
- Deposits replicate actual held proportions, not target weights. Rebalancing must be a separate protected operation.
- Empty sleeves, first deposit, full exit and reopening require a complete bootstrap/dust policy.
- Surplus contribution bounds and affordable-share quote construction remain required.
- Rebasing, sender-extra-debit, malicious balance reporting and arbitrary hooks are not universally supported. Admission and code/route review remain necessary.
- A complete fee/tax matrix, invariant tests across repeated multi-user actions, adversarial route tests, economic review, full-watchlist forks and canaries remain required before any deployment.
- Display NAV/performance still needs indicative pricing, but that display must not determine issuance.

The approved exploration does not authorize deployment or replacement of the existing vaults.

## Validation checkpoint

- Solidity 0.8.24 compilation succeeded.
- 13 local research tests passed, including 1,024 fuzz cases for ceiling-rounding preservation, actual received amounts under 3% tax, donation changes, rollback of partial purchases, cross-route balance theft rejection, cash limits, and withdrawal floors.
- At Robinhood block 69508375, the real Aria/HARMONIC/PROMETHEUS ETH join and ETH exit test passed. An established holder was seeded in the fixture, a second holder joined for 0.99 shares, then exited; the initial holder's final exit left zero token and WETH balances. The new holder spent 0.00399 ETH and immediately recovered 0.003875704180146340 ETH before gas. This is a test observation, not a promised return. The loss includes fees, market impact and deliberately overfunded token contributions.
- Reproduce with `node --use-system-ca scripts/run_watchlist_fork.mjs --successor --proportional --block=69508375` after privately configuring ROBINHOOD_RPC_URL. The runner allows read-only RPC methods.
- The separate 60-case legacy route matrix at block 69504022 passed 57 and failed 3 QUOTRON generic-router cases. QUOTRON's required specialized router passed its dedicated single round-trip test at that same block. This does not establish full-watchlist vault readiness.
- No live transaction, source approval or production deployment occurred.
