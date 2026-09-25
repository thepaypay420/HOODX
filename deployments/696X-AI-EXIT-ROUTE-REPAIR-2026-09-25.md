# 696X AI exit route repair — 2026-09-25

## Root cause

At Robinhood Chain block `72531387`, the complete 696X withdrawal reverted in the executor with `InvalidAmount()` (`0x2c5211c6`). Constituent-by-constituent simulation isolated the failure to AI (`0x2E8c…1e18`).

- AI balance sold by a Max exit: `124.554714621255642706 AI`
- Existing route: direct AI/WETH Uniswap V3, 1% fee
- Oracle value: `0.012872062145327253 WETH`
- Immutable 97% contract floor: `0.012485900280967435 WETH`
- Existing route output: `0.012483002036960990 WETH`
- Shortfall: `0.000002898244006445 WETH`, or about 3 basis points

The transfer into the executor and the swap both completed inside the reverted trace. The executor reverted because the received WETH was below the immutable floor. The harvest transaction did not change the AI route; it merely caused the current complete-exit state to be rehearsed again.

## Reviewed repair

Admit and select the existing direct AI/WETH Uniswap V3 0.3% pool at `0xD784…D659`, retaining the current oracle and every vault safety check. This is an append-only policy configuration followed by an in-place route selection through the existing curator controller.

The two transactions do not transfer assets, approve tokens, swap, withdraw, migrate, upgrade, or redeploy the vault.

## Fork evidence

Pinned fork block: `72531387`.

- Full live AI balance through the 0.3% route returned `0.012516976921778918 WETH`, above the protected floor.
- After policy admission and controller replacement, the complete Max ETH withdrawal succeeded and burned all selected shares.
- The route identity is validated by the existing V2 executor against the canonical V3 factory.
- The policy owner, controller curator, controller vault, vault owner, old configuration ID, pool address and chain ID are all rechecked immediately before a wallet request is prepared.

Test: `test/v2/AiExitRepairForkV2.t.sol` — 2 passed, 0 failed.

## Remaining limitation

The live V2 vault has one active route per asset and an immutable 97% oracle floor. No fixed route can guarantee execution through arbitrary future liquidity or price dislocation. Direct proportional asset redemption remains available without swaps, and the successor V3 design supports bounded fallback routes. The website now distinguishes deterministic protected-floor failures from transient RPC failures and does not retry deterministic failures.
