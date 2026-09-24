# Aria, HARMONIC and PROMETHEUS execution check

Checked 2026-09-22. No transaction broadcast and no live configuration changed.

Uniswap frontend returned indicative quotes for 0.001 ETH without connecting a wallet: approximately 700.42 Aria, 1899.44 HARMONIC and 5818.3 PROMETHEUS. These are transient frontend quotes, not executed trades. The Aria details panel identified Uniswap API routing and automatic 2.50% slippage; it did not expose an exact pool path.

DEX Screener's public token-pairs endpoint returned active Uniswap V4 markets for all three exact token addresses. Largest listed pools at the sample:

- Aria: 0x84ee7bda8d15c2605eb78326862827f961d659cc2ba97d26845cd0156e6e5606; reported liquidity $190,803.27.
- HARMONIC: 0x77ea11bbfb8f1259c702cb0ebc2105b7c007db89cf30c2f1a8776886a4467c07; reported liquidity $119,703.10.
- PROMETHEUS: 0x627c2c78063757b8e85ef1eae046df8ad0695a1ebd3dbb6b62aec2ee516de2e8; reported liquidity $68,519.14.

Current-fork block 69497531: all nine existing SuccessorWatchlistForkTest tests for these tokens passed at 0.0001, 0.001 and 0.005 ETH. Tests use real successor executor buys and sells, quoter-derived 97% floors, and check token/WETH/native/bridge residual balances. Hook activation is simulated locally. These establish execution capability, not independent valuation or live hook approval.

At 0.001 ETH, round-trip returns before gas were:
- Aria: 0.000940900813036845 ETH.
- HARMONIC: 0.000980100439209042 ETH.
- PROMETHEUS: 0.000979120980087713 ETH.

This corrects the overly broad label "unsupported": trading routes work in the successor. Remaining qualification is independent valuation for issuing/redeeming pooled shares, economic reference protection and full-vault release testing. Neither DEX display prices nor instantaneous swap quotes are approved as replacement NAV oracles by this check. Existing protection thresholds are unchanged.
