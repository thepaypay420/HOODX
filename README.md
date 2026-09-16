# 696X

Private. Isolated meme-index platform on **Robinhood Chain 4663**.

Not the LP desk. Not Krystal. Not CHUMP. Not Ramses. Nothing here spends ETH
until you explicitly deploy and seed.

> Build your own meme index. Share it. Earn a cut when friends ape in.

**$696X** is Gen-0: [696_eth’s RH watchlist](https://x.com/696_eth/status/2100067116594725086).
His X avatar is on the index card. Anyone else forges a pack, drops `/i/{slug}`,
and takes a cut on ape-ins.

Read **[DESIGN.md](DESIGN.md)** before a mainnet tx.

## Product

ETH in, ETH out, one ERC20 per basket.

| | Gen-0 `$696X` | User index |
|---|---|---|
| First mint | 0.08 ETH (~$200) | 0.02 ETH |
| Join fee | 50 bps | 10 proto + 0–50 creator (cap 100) |
| Redeem | 0 | 0 |
| Smart floor | sleeves under $10 stay WETH | same |
| Cash | ≥25% WETH | same |

Creator fees land on `creatorRecipient`. The original creator (or curator)
can **reroute that address** later — e.g. point 696X fees at 696 — without
handing over add/remove.

Add/remove is owner-only. `removeToken` requires the vault balance of that
coin to be 0 (sell to WETH first). Pack must keep at least 2 names.

Slug `696x` is reserved (`create696x`). `hoodx` is also blocked.

## Weighting (696X)

PONS+AI+CASHCAT ≈ 83% of raw mcap. Default is **sqrt mcap + 10% cap + 3%
policy floor**, 2-hop ×0.55, drop dead books (QUOTIENT).

At $200: ~10 names held, ~26% cash. Full 17 when NAV ≳ $333.

## Website

Next.js 15 + TypeScript + Tailwind + viem (injected wallet). No wagmi.
Futuristic HUD: Oxanium / Syne, starfield, pack-power meter, live add/remove.

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

Env names only: `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`,
`NEXT_PUBLIC_FACTORY_ADDRESS`, `NEXT_PUBLIC_VAULT_ADDRESS`. No private keys
on Vercel. Vercel project root: `web/`.

## Contracts

`contracts/HoodxFactory.sol` clones `contracts/HoodxIndex.sol`.
`create696x` is owner-only. `create(name, symbol, slug, tokens, creatorFeeBps)`
is anyone. Compile with forge/remix.

## Math (look-only)

```bash
python3 refresh.py
python3 plan.py --nav 200
python3 plan.py --write-web
python3 -m unittest tests.test_weights tests.test_vault
```

Default is look-only. First mint from a dedicated EOA, never a shared live
trading key (nonce collision).
