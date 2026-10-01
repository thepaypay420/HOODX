# Stock LP vault security review

Date: 2026-09-30. Scope: `HoodxStockLpVaultV1` (one-click ETH entry and exit), `HoodxLiquiditySleeveV4`
(one Uniswap V4 range per sleeve), `HoodxStockLpControllerV1` (curator policy) and `V4Types`, on branch
`research/stock-lp-vault`.

This is an internal review checkpoint, not a third-party audit and not authorization to deploy. An
independent audit is recommended before TVL grows beyond the launch cap.

## Result

No unresolved critical or high-severity issue was found in the reviewed scope. One medium liveness issue
was found during review and fixed before this report (F1). The remaining items are disclosed limitations.

## Findings

1. **F1 — Fee transfer could block exits (Medium, FIXED).** The performance fee was originally pushed to
   the treasury inside every PoolManager callback, and every redemption collects fees first. Tokenized
   stocks are issuer-controlled upgradeable tokens. If an issuer blocklisted the treasury, every fee-touching
   operation on that sleeve, including user redemptions, would revert. The fee is now set aside as
   `feeOwed0/1` inside the sleeve and pulled by anyone with `claimFees()`. Every pro-rata balance excludes
   owed fees, and compound/reband revert if they would spend them. Regression test: blocklisted treasury,
   claim fails, ETH exit and in-kind redemption succeed, owed fees preserved and paid once unblocked.
2. **F2 — TVL cap is soft (Low, accepted).** The cap infers vault NAV from the depositor's own execution
   cost. It is conservative (costs inflate the estimate) and cannot move value between holders, but it is a
   capacity guard, not a hard accounting limit.
3. **F3 — Minimum deposit gas (Info).** An 8-sleeve deposit uses 6.6–9.1M gas (about $0.29–0.40 at the
   measured base fee). At the $10 minimum, gas is about 2.4% of the deposit. Exit uses 2.8M gas (~$0.12).
4. **F4 — Issuer token controls (Medium, external, disclosed).** A paused or blocklisted stock token stops
   ETH entry and ETH exit for the whole vault, because both touch every sleeve. `exitToSleeveShares` still
   works (sleeve shares are HOODX ERC-20s). Each sleeve can then be redeemed independently, so one frozen
   stock cannot trap the others.

## Security properties checked

1. **Callback authentication (Cork, May 2025).** Both `unlockCallback`s require `msg.sender ==
   PoolManager` and a self-initiated unlock flag. No hooks are used anywhere: every sleeve, swap and
   ETH/USDG pool key must have `hooks == 0` and a static fee (dynamic-fee flag rejected).
2. **Price-independent deposits (Gamma 2024, Arrakis).** Deposits are in-kind and pro-rata: every sleeve
   receives at least the depositor's fraction of both its liquidity and its idle balances (rounded up), so
   a manipulated pool price cannot mint excess shares. Entry additionally requires every sleeve pool to agree
   with the controller's independent TWAP reference within its band, and fails closed if a reference is
   unavailable.
3. **Rounding across repeated operations (Bunni, Sept 2025).** Deposits round contributions up and exits
   round down. Tested: 40 tiny redemptions at a price pushed far out of range never decreased liquidity or
   idle balance per remaining share. Repeated $15 entry/exit cycles never decreased holder backing.
4. **No arbitrary calls or approvals (LI.FI 2024, Socket 2024).** Users send ETH only and grant no
   allowances. The vault executes no caller-supplied calldata. Routes are fixed per sleeve at construction.
5. **No per-user fee accounting (Popsicle 2021).** Fees accrue to sleeve-level balances owned pro-rata by
   shares. Share transfers carry no reward state.
6. **First-depositor and donation attacks.** Deposits require a controller bootstrap, which mints permanently
   locked dead shares. Supply can never return to zero. Donations of USDG, stocks or ETH neither block
   operations nor pay out to users. Unsolicited ETH is rejected.
7. **Exact V4 settlement.** ERC-20 debts use sync → transfer → settle in one call. Native ETH settles with
   an explicit amount, never `address(this).balance`. Partial fills revert (`Illiquid`).
8. **Always-available exit.** ETH exit needs no price reference. Pausing stops entry only. The emergency
   exit transfers sleeve shares with no swap, pool, price or manager dependency.
9. **Bounded authority.** The curator can harvest, compound and reband only under the controller policy
   (dwell, cooldown, reference agreement). The controller can bootstrap and rescue unrelated tokens. Nobody
   can withdraw user assets, mint unbacked shares or change the fee recipient. Ownership cannot be renounced.
10. **Carried over from the live HOODX vaults.** 5-minute deadline window, minimum shares, non-zero exit
    floor, recipient validation, no share transfers to the vault or during an operation, renounce disabled,
    claim-style deferral for a failing transfer (F1).

## Accepted limitations

- Strategy risk: about 50% stock beta over short windows. LP fees offset but do not remove stock drawdowns.
- Stock tokens are upgradeable proxies. Their behaviour can change after launch without any runtime-code
  change visible to the vault.
- The TWAP reference protects entry only. Exits are bounded by the user's own `minEthOut`.
- Performance and yield figures come from backtests and fork measurements. They are not a verified APR.

## Validation

- Fork suite at block 76,679,496 (2 sleeves): 22 passed. Covers entry, partial exit, full exit, $10 minimum,
  $2k cap, slippage bounds, pause, fee pull, blocked treasury, access control, the Bunni pattern, a manipulated
  pool, a broken reference, donations, and the route checks.
- Maximum basket at current block 76,917,183 (8 sleeves, each stock's cheapest route): full lifecycle
  passed, ETH round trip 99.86%.
- Full offline Foundry suite: 328 passed, 0 failed, 25 fork tests skipped without an RPC.
- Runtime sizes: vault 13.3 KB, sleeve 14.4 KB, controller 8.5 KB, all below the EIP-170 limit.
- Nothing was signed or broadcast during this review.
