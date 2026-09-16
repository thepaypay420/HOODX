# HOODX

Build a meme index. Share it. Earn a cut.

HOODX is a factory for baskets on Robinhood Chain **4663**. Anyone mints an index, drops `/i/{slug}`, and takes a cut on joins. **$696X** is the first index — [696_eth’s RH watchlist](https://x.com/696_eth/status/2100067116594725086) as one bag.

Private. Look-only until you deploy. DYOR.

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
| `/` | HOODX home · featured $696X · create |
| `/i/696x` | first index: curator, add/remove, join / leave |
| `/i/[slug]` | any index |
| `/create` | mint a new index |

No private keys on Vercel.

## Contracts

`contracts/HoodxFactory.sol` clones `contracts/HoodxIndex.sol`.

```bash
python3 -m unittest tests.test_weights tests.test_vault
python3 plan.py --nav 200
```

Read **[DESIGN.md](DESIGN.md)** before a mainnet tx.
