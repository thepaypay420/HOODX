# 696X MEME oracle repair

Prepared 2026-09-22 for the existing V2 vault `0x531832cD20d33Ee974AFEE7BA5720b8f3F2C9292`. This does not migrate assets or change the MEME buy/sell routes.

## Cause

The live MEME oracle reverted with `InvalidReference()` because pool `0x97BCdd384fC144899545dEB749b6DAF2AA52a2C5` had current liquidity `2,207,596,717,843,538,952,427`, below its immutable reviewed floor `16,229,335,552,032,950,196,823` at RPC block 70243612. The other seven held constituents valued successfully. Direct in-kind redemption remained available.

## Repair

- Keep the original immutable MEME oracle as the primary source.
- Deploy a second `HoodxTwapV2` over MEME/WETH V3 pool `0xE2c12a7379706A291CadAaEc1d22458be2f7239D` with the same 1,800-second window and unchanged absolute depth floor.
- Deploy `HoodxRedundantOracleV2`, pinning both source runtime hashes. When both sources pass their own depth/history checks they must agree within 3%; when exactly one passes, that source remains available for valuation and protected exits.
- Append a new policy configuration preserving the current MEME buy/sell route bytes, then call the existing vault's `replaceConfig`. No token or share movement occurs in these four setup transactions.

## Evidence and gates

- Four local redundant-oracle tests passed: agreement, single-source fallback, disagreement/double-failure rejection, and configuration validation.
- A fresh Robinhood fork test passed with the live vault and balances. The independent source TWAPs agreed within 2%; the failed primary fell back to the secondary; policy approval and in-place replacement succeeded; the curator's complete Max ETH exit sold all eight held constituents, paid ETH, and burned all selected shares.
- Security review found no concrete issue for the intended direct immutable TWAP sources. Runtime hash pinning does not make arbitrary proxy sources safe; only the reviewed direct `HoodxTwapV2` deployments are permitted here.
- Live wallet flow is limited to the curator on chain 4663, refreshes state/gas/balance per step, caps combined gas at 0.0055 ETH, verifies each transaction identity and receipt, and re-simulates Max after replacement.

Production status is determined only by verified receipts recorded in `robinhood-4663-meme-oracle-repair.json`. Until all four receipts and the final Max simulation are recorded, the existing raw-assets exit remains the reliable live recovery path.
