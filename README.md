# HOODX

Build your own meme index. Share it. Earn a cut when friends ape in.

**$696X** is Gen-0 — [696_eth’s RH watchlist](https://x.com/696_eth/status/2100067116594725086) as one bag. Anyone else forges a pack, drops `/i/{slug}`, and takes a cut on ape-ins.

Private. Robinhood Chain **4663**. Look-only until you deploy.

> Don’t pick one coin. Launch a basket. DYOR.

## Product

ETH in, ETH out, one ERC20 per basket.

| | Gen-0 `$696X` | Your index |
|---|---|---|
| First mint | 0.08 ETH (~$200) | 0.02 ETH |
| Join fee | 10 bps protocol + 40 bps creator | 10 bps protocol + 0–50 bps creator |
| Redeem | 0 | 0 |
| Floor | sleeves under $10 stay WETH | same |
| Cash | ≥25% WETH | same |

Creator fees land on `creatorRecipient`. Point that wallet at 696 later without handing over add/remove. Protocol 10 bps is on **every** index.

Tap chips to curate. Live vaults sync a burst as one tx. Pack keeps at least 2 names. Sell to WETH before ejecting a held coin.

Slug `696x` is reserved. `hoodx` is blocked.

## Website

Next.js 15 · TypeScript · Tailwind · viem. Vercel root: `web/`.

```bash
cd web
cp .env.example .env.local
npm install
npm run dev                  # http://127.0.0.1:3100
```

| Route | |
|---|---|
| `/` | $696X card + forge |
| `/i/696x` | curator card, add/remove, ape / leave |
| `/i/[slug]` | any index |
| `/create` | forge a pack |

No private keys on Vercel.

## Contracts

`contracts/HoodxFactory.sol` clones `contracts/HoodxIndex.sol`.

```bash
python3 -m unittest tests.test_weights tests.test_vault
python3 plan.py --nav 200
```

Read **[DESIGN.md](DESIGN.md)** before a mainnet tx.
