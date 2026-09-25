# HOODX official vault catalog

Prepared September 24, 2026 for Robinhood Chain (chain ID 4663).

## Launch construction

Every new official vault starts with a 25% WETH reserve. The remaining 75% uses square-root market-cap weighting. Each asset is bounded to 7.5%–25% of the full vault and rounded to 0.05%. This gives larger companies more influence while preventing a mega-cap from swallowing a theme and keeping every initial sleeve large enough to trade efficiently.

The weights below are the saved on-chain targets used by the first deposit. They are not a display-only model.

| Vault | Initial asset weights | 7D model vs ETH |
| --- | --- | ---: |
| CHAINX | MSTR 25%, COIN 25%, CRCL 17.5%, GLXY 7.5% | +14.00% |
| CHIPX | NVDA 21.6%, AMD 9.4%, INTC 7.6%, TSM 14.15%, MU 10.25%, AVGO 12% | +6.11% |
| AIX | NVDA 20.45%, META 12.35%, PLTR 7.5%, MSFT 16.85%, GOOGL 17.85% | +1.65% |
| CULTX | GME 12.55%, AMC 7.5%, RDDT 19.1%, DJT 7.5%, BB 7.5%, RBLX 20.85% | +1.17% |
| HLTHX | MRNA 10%, LLY 25%, HIMS 7.5%, PFE 7.5%, JNJ 25% | +1.68% |
| CLOUDX | SHOP 14%, NET 7.5%, SNOW 7.5%, ORCL 21%, MSFT 25% | +1.31% |
| REALX | GLD 25%, SLV 25%, USO 7.5%, USAR 17.5% | -0.51% |
| COREX | SPY 21.25%, QQQ 16.75%, SGOV 7.95%, GLD 9.25%, VTI 19.8% | +0.07% |
| EDGE | SPCX 25%, TSLA 20%, BA 7.5%, LMT 7.5%, RCAT 7.5%, USAR 7.5% | -1.11% |
| ICONX | AAPL 25%, AMZN 14.8%, COST 7.5%, META 12.7%, NFLX 7.5%, LULU 7.5% | +0.33% |

The seven-day number is a pre-launch underlier model measured against ETH. It uses the exact initial weights and the 25% WETH reserve. It is not realized vault performance.

## Identity and custody

The official curator wallet `0x134D468B0bcaeA6DF127916f951F7938c06A37C6` is the curator, creator, fee recipient, treasury and factory owner for all ten vaults. Each vault is created empty with its atomic rebalance controller installed during the same creation transaction.

## Route qualification

- 47 unique Robinhood Chain assets were bound to exact token addresses.
- Every route is direct to WETH or bridges through USDG using pinned Uniswap V3/V4 pool data.
- V4 routes are hook-free. V3 routes have active liquidity and 30-minute observation history.
- The catalog fingerprint is `0x794a8579af3b2619d85c6a793d67b5265ca7ec3657d8d83ba8f105c850b593cf`.
- The machine-readable evidence is in `official-vault-catalog-2026-09-24.json`.

Market-cap inputs come from CompaniesMarketCap's company dataset; ETF weights use its ETF assets-under-management dataset. The values are a dated launch input. Changing market caps later does not silently change on-chain targets.

## Validation

- 47 routes passed small and large fork buy/sell round trips: 94 route cycles.
- All ten exact smart-weight vaults bootstrapped from ETH and fully exited to ETH on a current-state fork.
- The live policy, implementation and two-step route-administrator ownership path were rehearsed together.
- All ten vault/controller pairs were created against the live infrastructure in the rehearsal; CHAINX then completed a bootstrap and full ETH exit.
- Every vault target totals 10,000 bps including WETH; every asset stays inside the 750–2,500 bps bounds.

