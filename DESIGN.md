# HOODX — build a meme index, share it, earn a cut

Isolated side project on Robinhood Chain 4663. Do not seed from vault idle ETH.

`$696X` is Gen-0. The factory is HOODX.

## The product

> Build your own meme index. Share it. Earn a cut when friends ape in.
>
> $696X kicks it off — Gen-0 index of the @696_eth RH watchlist. Whole pack, one bag.
>
> Then anyone can mint their own index, drop the link, and take a small fee on volume.
>
> Don’t pick one coin. Launch a basket. DYOR.

`$696X` is index zero. ETH-in / ETH-out vault. `HoodxFactory` lets anyone clone
that vault, pick 2–24 RH names, set a slug, and take a creator cut on every ape-in.

The Uni pool is **phase 2**, after mint/redeem is boring.

## Why a factory, not one token

A single watchlist token is a fund we have to market forever. The loop that
spreads is: **you** pick the pack, drop `/i/yourslug`, friends ape, **you**
earn. 696X is the proof it works and the first shareable link. His X picture
sits on the Gen-0 card.

## Fees

Fee on **mint volume** (not a Uni hook yet):

| Cut | Default | Who |
|---|---|---|
| Creator | 40 bps (0.40%) | whoever launched the basket, paid in WETH to `creatorRecipient` |
| Protocol | 10 bps (0.10%) | platform |
| **Total** | **50 bps (0.50%)** | Redeem is free. Combined cap 100 bps. Creator 0–50. |

Platform fee is on **every** index, including user-submitted ones.

`creator` (the address that minted the index) or `owner` can call
`setCreatorRecipient(addr)` — or pass `recipient_` in `create` /
`create696x` — so fees can move to 696 later without transferring the pack.
Curation (`addToken` / `addTokens` / `removeToken` / `removeTokens`) stays
with `owner`. Creator fee is 0–50 bps on top of the protocol cut.

First mint: 696X **0.08 ETH (~$200)**. User-created indexes **0.02 ETH**.

## Same vault guts (smart floor, no dust)

```
friend ETH ──10 bps──► protocol
           ──40 bps──► creatorRecipient
           └──net──► WETH buffer
                       ├── ~25%+ stays WETH (ETH exits)
                       └── curator rebalances names with sleeve ≥ $10
```

Skip names under $10 into WETH. Do not dump that weight onto PONS. Redeem
pays ETH from the buffer, never 17 airdrops. Deposits do **not** 17-swap.

At **$200** 696X holds ~10 names (PONS…QUOTRON) and ~26% cash. Full 17 when
NAV ≳ $333. QUOTIENT stays dead.

Weights for 696X: capped sqrt-mcap (10% / 3%), 2-hop ×0.55. User baskets
default to equal weight unless they pick from the 696 tape (then sqrt).

## Add / remove

Seamless in the HUD: every catalog chip is on or off. Tap to lock or eject —
the pack updates instantly. Live vaults debounce a burst of taps into one
`addTokens` / `removeTokens` tx. Drafts persist in localStorage. Remove
reverts if the vault still holds that ERC20 — sell to WETH first. Minimum 2
names.

## Contracts

| | |
|---|---|
| `HoodxIndex.sol` | Cloneable ERC20 vault. `initialize` once. `deposit` / `withdraw`. `setCreatorRecipient`. |
| `HoodxFactory.sol` | EIP-1167 clones. `create696x` (owner). `create` (anyone). `bySlug`. |

Share URL: `/i/{slug}`. Slugs `696x` and `hoodx` are reserved.

NAV = live WETH + owner-posted `priceWethWad`. Website refuses mint if posted
NAV and Dex tape disagree >2%.

## Website

`web/` — Next.js + viem, no private keys. Quiet dark UI: Instrument Serif + Outfit.
HOODX is the platform. $696X is the first index, with 696_eth’s picture on the home card.

| Route | |
|---|---|
| `/` | HOODX home · featured $696X · create |
| `/i/696x` | join / leave / book / curate |
| `/i/[slug]` | any index |
| `/create` | pick coins, set fee, mint, copy link |

Vercel project root: `web/`.

## Isolation

EOA not mid-CEO, or a dedicated index wallet. Never Krystal ETH. Look-only
until an explicit deploy. Same EOA as a live bot = **nonce collision**.

## What this is not

- Not HOOD10. Constituent `Index` ("The Index") is one name in 696X.
- Not a streaming management fee.
- Not permissionless rebalance (creator keeps the book from going dust).
- Not a seeded Uni pool yet.
- Not live. Nothing here spends ETH.
