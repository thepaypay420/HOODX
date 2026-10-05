# DeBank / Rabby integration proposal: HOODX (Robinhood Chain)

Goal: HOODX vault tokens (BOOSTX, STKX and the index tokens) show their value in Rabby and on DeBank. Today they show no
price because they do not trade on a DEX; they are minted and redeemed directly against the vaults, so their value is
the vault's net asset value per share, read on-chain.

Submit at <https://debank.com/proposal> (protocol integration request). The short version below fits the form; the
technical section is for the integration team.

---

## Short version (paste into the proposal)

**Protocol:** HOODX
**Chain:** Robinhood Chain (chain id 4663)
**Category:** Yield / Index vaults
**Website:** https://www.xhoodindex.com
**X:** https://x.com/XHOODINDEX · **Telegram:** https://t.me/HOODXINDEX · **GitHub:** https://github.com/thepaypay420/HOODX
**Logo:** https://www.xhoodindex.com/brand/hoodx-x.png

HOODX is a set of on-chain vaults on Robinhood Chain: deposit ETH, receive an ERC-20 share token, withdraw ETH. Vaults:
Boosted ETH (BOOSTX, rule-based 0-2x ETH leverage), Hands-free LP (STKX, automated Uniswap V4 liquidity on tokenized
stocks) and index vaults (baskets of tokenized stocks and tokens, e.g. 696X).

Share tokens do not trade on a DEX, so they have no market price. Their value is on-chain: one read-only contract,
**HoodxVaultLens** (`0x09F856af8f1054C25f63C8C0d9516d79d2de1C11`, to be confirmed after deployment), returns the ETH and
USD value of any HOODX vault share or position:

- `sharePrice(address vault) -> (uint256 ethPerShare, uint256 usdPerShare)` (18 decimals; 1 share = 1e18 units)
- `positionValue(address vault, address account) -> (uint256 valueWei, uint256 valueUsd)`

Use eth_call (the functions are not `view` because oracle-free index vaults are valued with a quote that answers by
reverting). We would like positions shown under a "HOODX" protocol entry, valued with the lens.

---

## Technical details

### Vaults and how to find them

| Vault | Token | Address | Type |
|---|---|---|---|
| Boosted ETH | BOOSTX | `0x5e0135C3592095592C4B43d84c817c26A0F43515` | ETH leverage vault (Morpho + steakUSDG) |
| Hands-free LP | STKX | `0xB064d074Ff141A68771AF32c3EAB9Dd3c9379f6D` | Uniswap V4 stock-LP vault (live since 2026-10-05) |
| Hands-free LP V2 (retired, exit only) | STKX | `0x67D2327eA0C42Cf92C4601ebc59df0F3e9b2aa80` | same contract type |
| Index vaults (V2 factory) | per vault | `Created(address vault, string slug, address curator, address creator)` events of `0x5e846680bf8d702072b65e1e403d07e5a5f98b90` | index vault |
| Index vaults (atomic factory) | per vault | same `Created` event on `0x29349c79863b58e7ab470865f7c6df0b31dc7c17` (from block 71,893,730) | oracle-free index vault |

All share tokens are ERC-20 with 18 decimals. Every position is the holder's share balance in the vault token.

### Valuation (what the lens does; matches xhoodindex.com)

- **Boosted ETH:** `state()` returns `nav` (USDG) and `price` (ETH price at the vault's Morpho oracle);
  value in wei = `nav * 1e36 / price`.
- **Hands-free LP:** `holdings()` lists each stock sleeve (`sleeve, stock, sleeveShares, sleeveSupply, tickLower,
  tickUpper, tick, positionLiquidity`). Each sleeve = its Uniswap V4 position amounts at `spot()` plus idle token
  balances minus `feeOwed0/feeOwed1` (performance fees owed to the treasury), valued in USDG at the pool price; the
  vault owns `sleeveShares / sleeveSupply` of it. USDG to ETH at the ETH/USDG V4 pool (fee 100, tick spacing 1).
- **Index vaults with an oracle:** `totalAssets()` (ETH wei).
- **Oracle-free index vaults:** ETH plus WETH held (`freeBalance(weth)`, `freeBalance(0x0)`) plus, for each
  `constituents()` token, the controller's (`owner()`) `quoteRebalance(token, false, freeBalance(token))`, which
  reverts with `RebalanceQuote(uint256 output)` = ETH out.
- **USD:** the ETH/USDG Uniswap V4 pool price (`0x0000…` / USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`).

Price per share = vault value / `totalSupply()`. These are spot marks, suitable for display, not for settlement.

### Checked values (fork of 2026-10-05)

| Vault | Lens USD per share | xhoodindex.com |
|---|---|---|
| STKX | 0.9898 | 0.9900 |
| BOOSTX | 1.0198 | 1.0198 at the vault's oracle (My Vaults, platform total); the Boosted ETH page's market mark was 1.0236 |
| 696X | 99.73 | matches the platform total |

Source: `contracts/lens/HoodxVaultLens.sol`, tests `test/lens/HoodxVaultLensFork.t.sol` (tick maths within 1 ppb of
Uniswap's bounds; live pool prices bracketed; all vault kinds priced).

### Contact

HOODX treasury / curator: `0x134D468B0bcaeA6DF127916f951F7938c06A37C6`.
