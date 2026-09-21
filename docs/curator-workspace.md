# Curator workspace

## Product intent

Make a large basket understandable before asking a curator to change it. Four sections separate orientation, editable allocation, executable trades and constituent lifecycle. The same component serves both official vaults and other V2 vaults through the existing vault page.

## Research and decisions

- [Enzyme spot and basket trading](https://docs.enzyme.finance/user-documentation/blue-management/spot-markets) separates trade selection from review. HOODX now separates read-only simulation from wallet submission. HOODX does not have that product's basket-trade adapter: each curator rebalance remains an individual transaction.
- [Enzyme operations controls](https://docs.enzyme.finance/user-documentation/blue-enzyme-vaults/vault-settings/interactive-blocks) highlights the importance of price-feed quality and safe removal of tracked positions. Missing valuations remain unavailable rather than zero; removing a constituent has an explicit target / holdings / claims checklist.
- [Balancer managed-pool settings](https://github.com/balancer/balancer-v2-monorepo/blob/master/pkg/pool-weighted/contracts/managed/ManagedPoolSettings.sol) support weight changes at the protocol level. HOODX has different mechanics: saving targets does not trade existing holdings. The UI explains this at planning and review points. No gradual or automatic execution is implied.
- [Enzyme delegation](https://docs.enzyme.finance/user-documentation/blue-enzyme-vaults/vault-settings/delegation) relies on explicit protocol permissions. HOODX's current owner-only rebalancing cannot be turned into delegated bots or team execution with a frontend change.

## Delivered

Overview: single-block valuation snapshot, cash target comparison, drift count, basket capacity and a next-step prompt. Unavailable valuations and cash shortfalls take precedence over a healthy-state message.

Allocation: locked weights, exact-basis-point normalization, equal weights, explicit core/discovery/excluded groups, cash presets, search, drift filtering, before/after changes, local wallet/vault-scoped draft save/restore, CSV export and minimum-deposit coverage warnings. Core/discovery budgets are percentages of the entire vault, including cash. Presets prepare targets; they do not execute a strategy.

Trades: suggestions from saved targets, sales first, drift and minimum-value filters, percentage sale shortcuts, fresh oracle-protected minimum, read-only simulation, estimated gas fee, one-minute review validity, repeat simulation before wallet submission and receipt link. Suggestions are oracle-value estimates, not executable-price forecasts. No background quoting or polling was added.

Basket: approval lookup remains enforced; removal guidance stages a zero target or full sale, while on-chain balance and claim checks remain authoritative.

Creation: a three-step introduction explains approved assets, initial allocation, initial deposit and the curator workspace.

## Deliberately deferred

Market-cap and square-root-market-cap presets need robust coverage, explicit missing-data handling, a cap redistribution algorithm and a timestamped data review. They should never silently exclude an asset or treat missing market cap as zero.

Automatic recurring rebalancing, delegated trading, single-transaction basket rebalances and stop-loss execution need separate protocol and wallet capability analysis. They are not represented as available controls.

Fee estimates are estimates, not total cost guarantees. Pool fees and price impact are not inferred from an oracle value. A simulation can become stale before inclusion.

## Validation

Unit tests cover locked and excluded allocations, exact rounding up to 24 assets, core/discovery budgets, absent prices, free-balance sale sizing and incompatible drafts. Browser validation uses an isolated mock wallet exposing only a public address; signing is disabled. Production build and type checks are required before release.
