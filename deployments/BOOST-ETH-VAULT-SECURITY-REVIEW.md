# Boosted ETH vault security review

Date: 2026-10-04. Scope: `HoodxBoostVaultV1` (ETH in/out share token, Morpho position, swaps, rebalancing, fees),
`HoodxBoostSignalV1` (on-chain trend and volatility signal) and `BoostTypes`, in `contracts/boost/`.

This is an internal review checkpoint, not a third-party audit and not authorization to deploy. An independent audit is
recommended before TVL grows beyond the first $100k. Strategy basis: `docs/SMART-ETH-HIGH-VARIANT-2026-10-04.md`,
`docs/BOOST-ETH-ECONOMICS-2026-10-04.md`.

## Result

No unresolved critical or high-severity issue remains in the reviewed scope. The review and its tests found and fixed six
issues during the build (F1-F6 below). The design keeps every control of the live vaults (pro-rata non-dilutive entry,
never-paused exits, an exit with no swap, bounded curator, dead shares, deadlines, recipient checks) and adds the controls a
leveraged position needs: oracle-bounded swaps, a hard leverage ceiling, flash-loan ordering that never crosses Morpho's LLTV,
an emergency cut anyone can trigger, and a dead-man switch for a silent signal.

## Architecture and trust

| Component | Role | Trust |
|---|---|---|
| `HoodxBoostSignalV1` | 16 EMAs, hysteresis flags, ETH variance; `target()` | No owner, no parameters. Reads Chainlink only. Seeded once at deploy from published history (reproducible) and checked within 3% of the live feeds |
| `HoodxBoostVaultV1` | Shares, deposits, withdrawals, rebalance, fees | Owner = curator (treasury): may pause deposits and rescue unrelated tokens only |
| Morpho Blue market `0x7c82…66e2` | WETH collateral / USDG debt, LLTV 77%, free flash loans | Immutable Morpho Blue; Chainlink ETH/USD ÷ USDG/USD oracle (MorphoChainlinkOracleV2) |
| Uniswap V3 USDG/WETH 0.01% `0x52e6…71Ca` | Every swap | Callback authenticated; output bounded by the oracle |
| steakUSDG `0xBeEf…09dd` (Morpho Vault V2) | Idle dollars | ERC-4626, no gates; failure only blocks the dollar sleeve's ETH exit (the in-kind exit still works) |
| Chainlink ETH/USD `0x78F3…d3A9`, BTC/USD `0xa2c5…0251` | Signal inputs | 0.5% deviation / 24h heartbeat; 25h staleness limit; a >3x jump between updates is rejected |

## Security properties

1. **Non-dilutive deposits.** A deposit takes the vault's current shape (collateral, debt, dollars) and shares are minted on
   the NAV actually added (`navAfter − navBefore`), measured at one oracle price in one transaction. The depositor alone
   pays entry swap costs. Entry also requires the pool to agree with the oracle within `maxDivBps` (1%), so a stale or
   manipulated price cannot be arbitraged against holders. Fork-tested in all four regimes (0x, 0.5x, 1x, 1.8x) and fuzzed
   over random deposit/withdraw sequences: NAV per share never falls beyond 1e-9 (rounding dust from the ERC-4626 vault).
2. **Pro-rata, never-paused exits.** `withdraw` repays the leaver's share of debt (rounded up, so remaining holders never
   inherit debt), releases its share of collateral and dollars (rounded down) and returns ETH, bounded by the leaver's
   own `minEthOut`. When dollars on hand cannot cover the debt share, a free Morpho flash loan bridges it and is bought
   back with the released WETH (exact-output). `exitInKind` needs no swap and no price: the leaver brings USDG for its
   debt share (`previewExitInKind` returns the amount) and receives WETH and steakUSDG shares. Pausing affects deposits
   only.
3. **Leverage never crosses LLTV mid-operation (F1, F2).** Levering up (rebalance and deposits into a levered vault) uses
   a flash loan: USDG in, WETH bought and posted as collateral, then borrowed against the larger position to repay. The
   first draft borrowed before buying collateral, which Morpho correctly refused for large steps ("insufficient
   collateral"); the fuzzer found the deposit case (a deposit 3.7x the vault's size at 1.95x).
4. **Hard ceiling and emergency cut.** No action may leave LTV above 56.25% (2.29x). Above `HARD_CAP` (2.05x) anyone may
   call `rebalance()` at once, with no interval and even with a stale signal; it cuts to the cap with a wider (3%) oracle
   bound. Fork test: four successive oracle shocks (−3% … −12%) at 2x with a stale signal keep LTV below 56.25% and far
   from 77%. At the 2x cap, Morpho liquidation would need an instant −35% move between hourly checks; the worst one-hour
   falls in ten years of data were −28.8% (Mar 2017) and −26.6% (May 2021).
5. **Bounded rebalancing.** The contract computes direction and size; the caller supplies nothing. One call moves at most
   `maxSliceUsdg` ($100k) of exposure, at most once per `minInterval` (55 min), and only when the gap to target exceeds
   0.10x. Every swap must return at least oracle value × (1 − 0.5%). Fork test: an attacker pushing the pool +0.3% before
   a rebalance costs the vault less than the bound; a push to −0.7% (inside the 1% band) makes the rebalance revert
   rather than trade.
6. **Dead-man switch (F5).** If the signal is silent for 24h (e.g. a retired feed), anyone may step leverage down to 1x;
   a dead signal can never raise leverage. Fork-tested.
7. **Callback authentication.** `uniswapV3SwapCallback` requires the pool and a self-set flag; `onMorphoFlashLoan` requires
   Morpho and a self-set flag. Tested from strangers and from the pool/Morpho outside an operation.
8. **No arbitrary calls.** Users send ETH only (and USDG for `exitInKind`). Approvals are exact and reset; no caller
   calldata is executed. The vault accepts ETH only from WETH.
9. **Fees.** 10% of NAV-per-share gains above a high-water mark, minted as shares to the fee recipient at most every 30
   days; the HWM resets to the post-fee NAV per share. Fork-tested at a +20% price move: the fee is 10% of the gain to
   0.1%, and no fee is due until the mark is beaten again.
10. **Signal integrity.** The on-chain formula is an integer-exact port verified bit for bit against the Python reference
    over 60 pokes with 3h, 10h and >168h gaps (`test_replaysReferenceVectorsExactly`); the reference reproduces the
    backtest (2022-26: +32.4%/yr in both). Feeds: non-positive, future-dated, >25h-stale or >3x-jump answers revert.
    Fuzz: the target stays within [0, 2x] for any path.
11. **Carried over.** Dead shares at bootstrap (supply never returns to zero), 5-minute deadline window, minimum shares and
    deposit, recipient validation, TVL cap, ownership cannot be renounced, shares cannot be sent to the vault or the dead
    address or moved mid-operation.

## Findings fixed during the review

| # | Finding | Fix |
|---|---|---|
| F1 | Lever-up borrowed before buying collateral, exceeding LLTV on large steps | Flash-loan lever (`FLASH_LEVER`) |
| F2 | A deposit large relative to the vault had the same ordering issue | Deposits into a levered vault use the flash lever |
| F3 | Views ignored interest accrued since Morpho's last update (previews understated debt) | `_expectedBorrow()` reproduces Morpho's accrual (IRM rate, 3-term Taylor) |
| F4 | The hard-coded EWMA weight differed from 1 − 0.5^(1/336) in the 5th digit | Corrected; checked against an exact Decimal computation |
| F5 | A permanently dead signal could leave the vault levered indefinitely | Dead-man switch: down to 1x after 24h of silence |
| F6 | A withdrawal could sweep loose WETH belonging to remaining holders | Pays out only the balance change caused by that withdrawal |

## Accepted limitations

- **Strategy risk.** Leveraged ETH: at 2x a 30% fall costs about 60% before the vault can cut. Trend following lags sharp
  reversals; a crash out of a strong uptrend can hurt more than holding ETH (Oct 2025 backtest: −32% vs −28%).
- **No sequencer-uptime feed on Robinhood Chain.** After a sequencer outage the first prices may be stale; the oracle
  agreement check (deposits, ordinary rebalances) and the oracle-bounded swaps limit the impact, and liquidation needs a
  −35% gap from the cap.
- **Signal seed.** The initial EMA state is computed off-chain from public Coinbase hourly closes
  (`research/boost/boost_seed.py`) and published in `deployments/boost-eth-seed.json`; the constructor only checks the
  last prices against the feeds. Anyone can reproduce the seed. Within weeks the state is dominated by on-chain updates.
- **Dependencies.** Morpho Blue, the Uniswap pool, steakUSDG and Chainlink are external. A steakUSDG liquidity freeze blocks
  the dollar sleeve's ETH exit (tested: `exitInKind` still works). Empty Morpho liquidity only limits leverage (tested).
- **Reward tokens.** steakUSDG's extra rewards (~3.4%, Merkl-style) are not claimed by V1; economics count base yield only.
  Reward tokens sent to the vault would be "unrelated tokens" the curator can rescue. The curator commits to forwarding
  any to holders' benefit or leaving them.
- **MEV.** Rebalances are predictable from the public signal. Exposure is limited to the 0.5% oracle bound on at most $100k
  per hour; the 0.01% pool's depth ($25M) makes larger pushes expensive.
- **Keeper liveness.** A missed hour is applied in closed form; with no keeper the signal goes stale, ordinary rebalances
  stop, and the emergency cut and dead-man switch remain available to anyone. Exits never depend on the keeper.
- **Immutable parameters.** Cap ($1M), slice, bounds and fee are fixed at deployment; a change means a new vault.

## Validation

- `FOUNDRY_PROFILE=boost forge test` on a fork of Robinhood Chain mainnet (live Morpho, Uniswap, steakUSDG, Chainlink):
  **47 tests passed**, 0 failed, across `BoostSignal.t.sol` (10, unit + fuzz), `BoostVaultFork.t.sol` (30, including a
  40-run dilution fuzz) and `BoostVaultAdversarial.t.sol` (7: sandwich bound, manipulated pool, no borrow liquidity,
  illiquid dollar vault, price shocks with a stale signal, dead-man switch, the real seeded signal driving a vault).
- Runtime sizes: vault 22.3 KB, signal 4.7 KB (EIP-170 limit 24 KB).
- Nothing was signed or broadcast during this review.
