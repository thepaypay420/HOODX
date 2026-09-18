# HOODX — build a meme index, share it, earn a cut

Live on Robinhood Chain **4663**. `$696X` is Gen-0. The factory is HOODX.

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

`creator` (immutable launch identity) is the only address that can call
`setCreatorRecipient` / `setCreatorFee`. `owner` is the curator: add/remove,
targets, swap, pause, floors, genesis. Handing the book is **two-step**
(`transferOwnership` nominates `pendingOwner`; they must `acceptOwnership`
from that wallet). A typo to 0 / the vault / WETH / dead / routers reverts.
The new curator cannot steal or zero the creator cut.

Pass `recipient_` in `create` / `create696x` to set the fee wallet at mint.
HUD “Give to 696” is fees only. “Hand book to 696” nominates; 696 must Accept.

First mint: 696X **0.08 ETH (~$200)**. User-created indexes **0.02 ETH**.

## Same vault guts (smart floor, no dust)

```
friend ETH ──10 bps──► protocol
           ──40 bps──► creatorRecipient
           └──net──► vault buys the book (clone starts equal so first mint
                     clears minSleeveWeth on every name; curator then
                     `setTargets` to capped sqrt-mcap and swaps drift.
                     Later joins replicate live bags)

                       ├── sleeves under ~0.004 ETH stay WETH
                       ├── ~25% cash target
                       └── curator rebalances drift; leave sells the slice to ETH
```

Skip names under $10 / 0.004 ETH into WETH. Do not dump that weight onto
PONS. The depositor’s ETH is the capital — no curator seed. Redeem sells
that user’s pro-rata tokens + cash back to ETH (3% min-out per swap),
never 17 airdrops.

At **$200** 696X holds ~10 names (PONS…QUOTRON) and ~26% cash. Full 17 when
NAV ≳ $333. QUOTIENT stays dead.

Weights for 696X: capped sqrt-mcap (10% / 3%), 2-hop ×0.55. User baskets
default to equal weight unless they pick from the 696 tape (then sqrt).

## Add / remove

Seamless in the HUD: every catalog chip is on or off. Tap + to lock or × to
eject — the pack updates instantly. **Add token** pastes any Robinhood 0x;
the HUD looks up a Uni V3 WETH or V4 ETH/WETH pool on Dexscreener (18
decimals, max 24). Live vaults debounce a burst of taps into one
`addTokens` / `removeTokens` tx. Drafts persist in localStorage. Remove
reverts if the vault still holds that ERC20 — sell to WETH first. Minimum 2
names. Connect the curator (owner) wallet to edit a live book.

## Contracts

| | |
|---|---|
| `HoodxIndex.sol` | Cloneable ERC20 vault. `initialize` once. `deposit` / `withdraw`. Two-step `owner`. Creator-only `setCreatorRecipient`. `imageURI` / `contractURI`. |
| `HoodxSwap.sol` | Delegatecall swap / bind / RH quote seeds. Payable (deposit preserves msg.value). |
| `HoodxFactory.sol` | EIP-1167 clones of a deployed implementation. `create696x` (owner). `create` (anyone). `bySlug`. `imageURI`. |
| `UniTwap.sol` | `UniTwapOracle` V3 TWAP + V4 spot. |

Share URL: `/i/{slug}`. Slugs `696x` and `hoodx` are reserved.

NAV = live WETH + Uni V3 TWAP or V4 spot on each bound pool. One share starts
at **$100 of ETH** (`genesisEthPerShare`). After that, share price is NAV /
supply and moves with the basket. Joiners mint `min(credited NAV, net ETH) /
sharePrice` so slippage can mint 0.98 of a share and a stale-high mark cannot
mint extra. Fractions are the point. Every swap clears a 3% min-out; a buy
that cannot fill stays ETH. Leave sells the slice. HUD shows USD only from the
live ETH tape — never a hardcoded 2400 — plus cost basis and ROI.

## Share safety

Mint math is **ETH on-chain**. `$100` is the genesis unit: owner pegs
`genesisEthPerShare = $100 / live ETH-USD` before first mint (bounds 0.01–0.25
ETH). There is no USD oracle in the vault. A HUD fallback price must not change
how many shares you receive.

Catalog vs common vault/index drains:

| Attack | What it looks like | Defense |
|---|---|---|
| ERC-4626 inflation (1 wei + donate) | Victim mints 0 or 1 share, attacker takes the deposit | `minFirstDeposit` 0.08/0.02; 18-dec shares; dead shares on first mint |
| Donation / stealth rounding | Direct WETH in, preview still shows genesis | Empty `sharePrice` uses donated NAV / virtual shares; `minShares` reverts a stale preview |
| Join with no slippage (Indexed `minOut=0`) | Sandwich NAV, fewer shares than the HUD showed | `deposit(minShares)` required; HUD sends 97% of `previewDeposit` |
| Exit sandwich | Dump names while redeeming | `withdraw(shares, minEthOut)` plus per-swap 3% TWAP floor |
| Indexed DEFI5 (one token = pool value) | Flash-dump UNI, mint the rest of the book cheap | `totalAssets` / `mintAssets` sum **every** sleeve + WETH |
| V4 spot dump then mint | Same-block crash of a V4 name cheapens share price | Mint NAV uses `max(spot, lastPx)` for V4; V3 is 60s TWAP |
| Permissionless `restoreCash` on V4 | Dump spot, sell the vault’s bag at the crash | `restoreCash` is V3-only; owner `swapV3` still moves V4 |
| Extra shares from stale-high TWAP | credited NAV > ETH in, dilute LPs | `credited = min(delta, net)` |
| Peg 1 ETH/share or 1 wei | Ticket-size confusion / dust inflation | Genesis bounds 0.01–0.25 ETH; stranger cannot peg |
| Pause trap | Curator pauses and keeps ETH | Redeem stays open |
| Preview as oracle | Integrators treat `previewDeposit` as a price | EIP-4626: preview is manipulable; `minShares` is the check |
| Instant owner transfer | Typo to 0x0 / vault / WETH bricks the book | Two-step `pendingOwner`; reject 0 / vault / WETH / dead / self / routers |
| Stranger snatches the book | Front-run `acceptOwnership` | Only the nominated wallet can Accept; owner can Cancel |
| New curator steals fees | `transferOwnership` then `setCreatorRecipient` / fee=0 | Recipient and fee bps are **creator-only** |
| HUD “Give to 696” | One click was fee-only; looked like the book | Separate Nominate + checkbox + Accept; full pending address shown |

Dead shares (`0xdead`, ~`1e12` wei of ETH at genesis, ~$0.002) stay after the last live LP exits so the vault cannot be 1-wei inflated again. Last live redeem sweeps leftover tokens so ETH is not stranded. Next join is priced at genesis again.

V4 names still mark **spot** on exit. Sandwich of a V4 sleeve is capped by the 3% min-out. A slow dump (not same-block) can move `lastPx`. That is the remaining oracle limit until V4 has `observe()`.

## Website

`web/` — Next.js + viem, no private keys. Uniswap-quiet dark HUD: Outfit + IBM Plex
Mono, teal `#1fd4c6` / gold `#e0b54a` from the hat mark. Telegram
https://t.me/HOODXINDEX sits next to GitHub in the nav (desktop) and footer.
HOODX is the platform. $696X is the first index, with 696_eth’s X profile picture
on the token.

| Route | |
|---|---|
| `/` | HOODX home · featured $696X · create |
| `/i/696x` | join / leave / book / curate |
| `/i/[slug]` | any index |
| `/create` | pick coins, set fee, mint, copy link |

Vercel project root: `web/`.

## Token image

HUD `$696X` uses [@696_eth](https://x.com/696_eth)’s current X profile picture
(`public/curators/696_eth.jpg`). That is the token art on the home card, nav,
`/i/696x`, and the live-index list.

Create paths pass `imageURI` (https or ipfs, ≤256 chars) on-chain. Wallets and
Blockscout read ERC-7572 `contractURI`. Curators can `setImageURI` from the index
card. HUD file uploads stay local. Live 696X ships
`https://www.xhoodindex.com/curators/696_eth.jpg`.

## Live holdings

The HUD holdings table marks **vault balances × TWAP**, not the $10 floor plan.
Held means `balanceOf > 0`. Missed means listed but the zap could not fill (3%
slip). Cash is WETH. 696 list column is capped sqrt-mcap.

`initialize` still plants equal `targetBps` so a small first mint can buy every
name above `minSleeveWeth` (~0.004 ETH). That is why a $200 bag looked like
~$10 each. Owner **696 list weights** writes sqrt-mcap targets, then swaps
drift (sell the tail, buy PONS/AI/CASHCAT). Later joins copy the live mix.

## Live funds (do not trap)

696X is live. User ETH sits in `0x6350f9e8e630785ABF09fD1127366998Ad821E33`.
Do not pause, set floors, hand the book to a dead key, unwind, or redeploy
that clone. Operator scripts that could trap funds are refused.

On-chain: `withdraw` ignores `paused`. A held name with `priceWethWad == 0` reverts
every exit (`Unpriced` / `NeedBuffer`). Curator HUD has no pause or setFloors.
Handing the book is two-step and, on live 696X, requires an extra ack that the
destination key is held.

## Signing

Do not share a nonce with another live bot on the same EOA.

## What this is not

- Not HOOD10. Constituent `Index` ("The Index") is one name in 696X.
- Not a streaming management fee.
- Not permissionless rebalance (the curator keeps the book from going dust).
- Not a seeded Uni pool yet.
