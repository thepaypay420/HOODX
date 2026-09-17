<p align="center">
  <img src="web/public/brand/hoodx-hat.png" width="108" alt="HOODX" />
</p>

<h1 align="center">HOODX</h1>

<p align="center">
  <b>Live on Robinhood Chain.</b> One token. A whole book.<br />
  Mint an index. Share the link. Earn a cut. Redeem cannot be paused.
</p>

<p align="center">
  <a href="https://t.me/HOODXINDEX">Telegram</a> ·
  <a href="https://x.com/696_eth/status/2100067116594725086">696 list</a> ·
  <a href="https://robinhoodchain.blockscout.com/address/0xeBFA7c94D6d708a242f84c98a048C84b59e95C24">$696X vault</a> ·
  <a href="https://robinhoodchain.blockscout.com/address/0x46eaB4De2BabF2AdE1cfC24C02b46888498ed2b9">Factory</a>
</p>

<p align="center">
  <img src="docs/hud-home.png" alt="HOODX HUD" width="920" />
</p>

HOODX is a factory for trustless meme baskets on **Robinhood Chain (4663)**. You pick 2–24 Uni V3 WETH or V4 ETH names, mint one ERC-20, and drop `/i/yourslug`. Friends send ETH. The vault buys the book. They hold one token — not seventeen airdrops.

**$696X** is live. It is index zero: [696_eth’s RH watchlist](https://x.com/696_eth/status/2100067116594725086) as a single bag, with 696’s X profile picture on the HUD. One share starts at **$100 of ETH**. Join buys the mix. Leave sells your slice back to ETH. Redeem is free.

<p align="center">
  <img src="docs/hud-696x.png" alt="$696X desk — You, ROI, vault names, Join / Leave" width="920" />
</p>

## Live

| | Address |
|---|---|
| Chain | Robinhood **4663** |
| Factory | [`0x46eaB4De2BabF2AdE1cfC24C02b46888498ed2b9`](https://robinhoodchain.blockscout.com/address/0x46eaB4De2BabF2AdE1cfC24C02b46888498ed2b9) |
| Implementation | [`0x7057904c24c1BD1252415033370a252427c262cc`](https://robinhoodchain.blockscout.com/address/0x7057904c24c1BD1252415033370a252427c262cc) |
| **$696X vault** | [`0xeBFA7c94D6d708a242f84c98a048C84b59e95C24`](https://robinhoodchain.blockscout.com/address/0xeBFA7c94D6d708a242f84c98a048C84b59e95C24) |
| WETH | [`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`](https://robinhoodchain.blockscout.com/address/0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73) |

First 696X mint is done (0.08 ETH). Later joins copy the live mix. Do not redeploy that clone.

## How it works

```
ETH in ── 0.10% protocol
       ── 0.40% creator
       └── net buys the book (Uni V3 TWAP / V4 ETH, 3% max slip)
              ├── names too small stay WETH
              ├── ~25% cash for exits
              └── Leave sells your slice back to ETH. Fee: 0.
```

| | $696X | Your index |
|---|---|---|
| First mint | 0.08 ETH | 0.02 ETH |
| Share at genesis | $100 of ETH | $100 of ETH |
| Join fee | 0.50% | 0.10% protocol + 0–0.50% you |
| Redeem | **0% · cannot be paused** | same |
| Book | 2–24 names · curator rebalances | same |
| Add a name | paste any RH `0x` with a V3 WETH or V4 ETH pool | same |

A name that cannot fill inside 3% stays ETH. NAV is every sleeve plus WETH — not one pool token standing in for the fund. USD on the HUD is the live ETH tape, never a hardcoded price.

## $696X

Capped **sqrt-mcap** weights (10% / 3% bands), ~25% WETH, 696’s list. The curator keeps the book from going thin. Creator fees and curation are separate keys: you can point the cut at 696 without handing add/remove.

Telegram: [t.me/HOODXINDEX](https://t.me/HOODXINDEX)

## Create yours

1. Open `/create` or the forge on the home page.
2. Name, ticker, slug. Pick 2–24 names — or paste a token `0x`.
3. Set your cut (0–50 bps). HOODX always takes 10 bps.
4. Mint. Share `/i/yourslug`.

`696x` and `hoodx` are reserved.

## HUD

`web/` — Next.js 15, viem, no private keys. Uniswap-quiet dark UI. Hat mark, teal `#1fd4c6`, gold `#e0b54a`.

| Route | |
|---|---|
| `/` | HOODX · featured $696X · create |
| `/i/696x` | You / ROI / vault / NAV · join · leave · book |
| `/i/[slug]` | any index |
| `/create` | mint |

```bash
cd web
cp .env.example .env.local
npm install
npm run dev     # http://127.0.0.1:3100
```

Vercel root: `web/`. `.env.example` already points at the live factory and $696X vault.

## Contracts

EIP-1167 clones. `HoodxFactory.create` for anyone. `create696x` for gen-0.

- `deposit(minShares)` — 97% of preview. Joins can close; **withdraw ignores pause**.
- `withdraw(shares, minEthOut)` — sells the slice, 3% per swap.
- Two-step `owner` (nominate → Accept). Creator-only fee recipient and bps.
- V3 TWAP + V4 spot (mint uses `max(spot, lastPx)`). `restoreCash` is V3-only.

```bash
python3 -m unittest tests.test_weights tests.test_vault
```

Read **[DESIGN.md](DESIGN.md)** for mint math, oracle limits, and the drain catalog.

## Guarantees

- Redeem stays open if joins are paused.
- A typo owner (zero, vault, WETH, dead) reverts. New curator cannot steal the creator cut.
- Do not redeploy live $696X. User ETH is already in the clone above.
- DYOR. Not HOOD10. Not a seeded Uni pool yet. Not financial advice.
