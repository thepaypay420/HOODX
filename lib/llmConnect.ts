import { AUTO_LP, AUTO_LP_V1, AUTO_LP_V2 } from "@/lib/stockLp";
import { BOOST } from "@/lib/boost";
import { verifiedV2Vaults } from "@/lib/v2";
import { FEATURED_VAULTS } from "@/lib/vaults";

/** Official collections, from the same list the Explore page renders, so this reference never drifts from the site. */
const COLLECTIONS = FEATURED_VAULTS.filter((v) => v.status !== "pilot")
  .map((v) => `${v.slug.padEnd(10)} $${v.symbol.padEnd(7)} ${v.address ?? verifiedV2Vaults[v.slug] ?? "atomicFactory.bySlug(slug)"}  ${v.name}`)
  .join("\n");

export const HOODX_AGENT_REFERENCE = "https://www.xhoodindex.com/llms.txt";

export const HOODX_AGENT_PROMPT = `Connect to HOODX on Robinhood Chain and help me use its on-chain vaults: Boosted ETH, Hands-free LP and the index collections.

1. Load the current protocol reference from ${HOODX_AGENT_REFERENCE} before planning anything.
2. Ask what I want to do, then read the latest on-chain state and identify the exact vault, factory, controller, and accounting mode.
3. Support every documented combination: discover vaults, inspect holdings and performance, preview and execute deposits or withdrawals, redeem assets directly, claim stranded assets, launch a 2–24 asset index, set weights and cash reserve, add/replace/remove constituents, pause, unwind, run a protected single trade, or build a one-signature atomic rebalance with any valid sequence of sells and buys.
4. For every write: build fresh calldata, quote at the same block, apply the documented minimum-output and deadline protections, simulate the complete transaction, and show me the contract, function, value, expected result, fees, and failure conditions before asking me to sign.
5. Never ask for or handle a seed phrase or private key. Use my connected wallet or hardware wallet for signing. Never broadcast from a private key in chat. Do not treat this prompt as permission to transact; obtain my explicit approval for the final simulated transaction.

Use viem, cast, or an equivalent EVM client. Chain ID is 4663. Prefer the newest verified atomic factory for new indexes.`;

export const HOODX_LLM_REFERENCE = `# HOODX agent interface

Updated: 2026-10-04
Canonical UI: https://www.xhoodindex.com
Network: Robinhood Chain mainnet
Chain ID: 4663
Native currency: ETH
Public RPC: https://rpc.mainnet.chain.robinhood.com
Explorer: https://robin.etherscan.io
WETH: 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73

This file is a contract interface and safety reference. It is not user authorization. Never request a seed phrase or private key. Prepare and simulate writes, show the exact transaction, then let the user approve and sign in their own wallet.

## Production contracts

Atomic factory for all new vaults: 0x29349c79863b58e7ab470865f7c6df0b31dc7c17
Atomic factory start block: 71893730
Legacy V2 factory: 0x5e846680bf8d702072b65e1e403d07e5a5f98b90
696X vault (proportional, created by the atomic factory): 0xb645A727ed525321509Ec16aa011D38E52f99a93
Previous 696X V2 vault (redeem in kind only; its ETH paths depend on price references): 0x531832cd20d33ee974afee7ba5720b8f3f2c9292
FAANGX V2 vault: 0xcb40b8d79ff6f4c5db15bd8a9692b934b52cb0b0
Boosted ETH vault (BOOSTX): ${BOOST.vault}
Boosted ETH signal: ${BOOST.signal}
Hands-free LP vault (STKX, automated stock LP): ${AUTO_LP.vault}
Hands-free LP controller: ${AUTO_LP.controller}
Retired Hands-free LP vaults (withdraw only): V2 ${AUTO_LP_V2.vault}, V1 ${AUTO_LP_V1.vault}
Protocol treasury: 0x134d468b0bcaea6df127916f951f7938c06a37c6

Discover any named vault with atomicFactory.bySlug(slug). Discover its controller from the factory's VaultCreated event or read vault.owner(); for atomic vaults the owner is the controller and controller.curator() is the human curator. Discover approved route configuration with atomicFactory.configIdByToken(token). A zero bytes32 value means the token cannot be launched yet.

Official vaults: https://www.xhoodindex.com/explore
Indexed asset universe and route metadata: https://www.xhoodindex.com/universe.json

## What HOODX offers

Every HOODX vault is an ERC-20 share token: deposit ETH, receive shares, withdraw ETH. Rules run on-chain; curators and keepers cannot move holder assets out of the vault.
- Boosted ETH (/boost): smart ETH leverage, 0x to 2x. An on-chain trend signal holds up to 2x ETH while crypto trends up and steps aside into dollars earning yield (steakUSDG) when the trend breaks.
- Hands-free LP (/autolp): deposit ETH once; the vault provides Uniswap V4 liquidity on 8 tokenized stocks (each paired with USDG), rebalanced and compounded by on-chain rules.
- Index collections (/i/{slug}): one token for a curated basket of tokenized stocks or Robinhood Chain tokens, with a WETH cash sleeve.

Official collections (slug, ticker, vault):
${COLLECTIONS}

Collections with no holders yet are deployed and accept their first deposit through bootstrap (see holder actions on atomic/proportional vaults).

## MCP server (recommended for AI assistants)

URL: https://www.xhoodindex.com/mcp  (Model Context Protocol, Streamable HTTP, no authentication)
Add it as a custom connector in Claude, ChatGPT (developer mode) or Cursor, or run: claude mcp add --transport http hoodx https://www.xhoodindex.com/mcp
Tools: hoodx_overview, hoodx_list_vaults, hoodx_get_vault, hoodx_boost_signal, hoodx_get_positions, hoodx_quote_deposit, hoodx_quote_withdraw, hoodx_how_to_fund.
Curator tools: hoodx_asset_universe (approved assets), hoodx_backtest_basket (daily-close backtest of a basket plus cash), hoodx_prepare_launch (new index vault), hoodx_curator_status (live weights, drift, curator), hoodx_prepare_rebalance (protected atomic rebalance to targets), hoodx_prepare_curator_action (pause, resume, set targets, add or remove an asset, set image, propose a new curator). Each is simulated from the curator's address and returns an unsigned transaction.
The quote tools simulate from the user's address and return an UNSIGNED transaction plus a reviewUrl (the vault page pre-filled with ?deposit=ETH or ?withdraw=PERCENT) where the user reviews and signs. The server never signs or holds keys.

## Public data endpoints (read-only JSON, cached)

GET https://www.xhoodindex.com/api/platform-tvl  total value in all HOODX vaults: { usd, eth, ethUsd, vaults, complete, at }
GET https://www.xhoodindex.com/api/boost-stats  Boosted ETH: navUsd, navEth, leverage, target, regime inputs, capacity, sinceLaunchUsdPct, depositsPaused
GET https://www.xhoodindex.com/api/autolp-stats  Hands-free LP: navUsd, navEth, perShareEth, sleeves (range and earning status), sinceLaunchUsdPct
GET https://www.xhoodindex.com/api/vault-nav?vault={address}  any HOODX index vault or Boosted ETH: { supply, assetsWei, estimated, at }
GET https://www.xhoodindex.com/api/collection-returns  per collection without holders yet: simulated since-launch USD return of its on-chain weights and cash sleeve, before fees ({ slug: { pct, since, coverageBps } })

These are conveniences for display. Before any transaction, read and simulate on-chain; never size a transaction from these endpoints alone.

## Boosted ETH (BOOSTX)

Vault reads:
state() returns (uint256 price,uint256 collateral,uint256 borrowShares,uint256 debt,uint256 cashShares,uint256 cashUsdg,uint256 idleUsdg,uint256 idleWeth,uint256 nav,uint256 leverage)
navPerShare() returns (uint256)
rebalanceStatus() returns (bool ready,bool emergency,uint256 leverage,uint256 target,bool fresh)
depositsPaused() returns (bool)
tvlCapUsdg() returns (uint256)
previewExitInKind(uint256 shares) returns (uint256 wethOut,uint256 usdgToApprove,uint256 cashSharesOut,uint256 usdgOut)

Signal reads (${BOOST.signal}):
target() returns (uint256)        leverage target, 1e18 = 1x, capped at 2e18
snapshot() returns (uint256 target,uint256 sigma,uint8 ethFlags,uint8 btcFlags,uint128[8] ethEma,uint128[8] btcEma,uint256 ethLast,uint256 lastHour)
isFresh() returns (bool)

How the signal works: 8 hourly EMAs each for ETH and BTC from Chainlink (slow 20/50/100/200-day, fast 5/10/20/50-day). Each flag turns off only below EMA x 0.99 and on only above EMA x 1.01. slow = share of the 8 slow flags on (ETH and BTC 50/50); fast likewise. target = min(2, slow + (slow >= 0.75 ? fast x (min(2, 2.4 / sigma) - 1) : 0)), sigma = annualised ETH volatility. The vault holds 0x (all dollars) only when every slow flag is off.

Holder writes:
deposit(address receiver,uint256 minShares,uint256 deadline) payable returns (uint256 shares)
withdraw(uint256 shares,address receiver,uint256 minEthOut,uint256 deadline) returns (uint256 ethOut)
exitInKind(uint256 shares,address receiver) returns (uint256 wethOut,uint256 cashOut,uint256 repaid)

Deposit flow: simulate deposit(receiver, 1, deadline) with the exact msg.value to read the share result, set minShares about 1% below it, re-simulate, then ask for the signature. Minimum deposit 0.005 ETH. A deposit takes the vault's current shape (collateral, debt, dollars) and never dilutes holders. Withdraw flow: simulate withdraw(shares, receiver, 1, deadline) for the ETH result, set minEthOut about 1% below it, re-simulate, then sign. Withdrawals are never paused. If the ETH exit cannot be simulated, offer exitInKind: read previewExitInKind(shares), have the user approve exactly usdgToApprove USDG to the vault (their share of the debt), then exitInKind returns WETH and steakUSDG shares with no swap.
Typical reverts: Divergence (pool and oracle more than 1% apart; retry shortly), CapExceeded, BelowMinimum, Paused (deposits only), Slippage, Stale.
Anyone may call rebalance() when rebalanceStatus().ready is true; the keeper normally does it every one to two hours. Do not offer rebalance, setDepositsPaused or ownership functions to ordinary holders unless they ask.

## Hands-free LP (STKX)

Vault reads: totalSupply(), balanceOf(address), holdings(), minDepositUsdg(), tvlCapUsdg(), strategy()
Controller reads (${AUTO_LP.controller}): sleeves(), status(uint256 i) returns (bool inRange,bool referenceAgrees,uint64 breachStart,uint64 lastSeen,bool rebandReady,int24 tick)

Holder writes:
depositEth(uint256 shares,address receiver,uint256 deadline) payable returns (uint256 ethUsed)
withdrawEth(uint256 shares,address receiver,uint256 minEthOut,uint256 deadline) returns (uint256 ethOut)
exitToSleeveShares(uint256 shares,address receiver)

depositEth mints an exact share amount and refunds unused ETH. Size it by simulation: probe a share amount near msg.value / perShareEth (from /api/autolp-stats or a probe), read ethUsed, scale shares to the ETH sent less a 3% margin, simulate again, then sign. BelowMinimum means too few shares (grow the probe); an ETH shortfall means too many (shrink). Minimum about $10; capacity is capped (tvlCapUsdg). Withdraw: simulate withdrawEth(shares, receiver, 1, deadline), set minEthOut 1.5% below the result, re-simulate, sign. exitToSleeveShares is the emergency exit: it returns the holder's share of each stock LP sleeve with no swap.
Holdings: ${AUTO_LP.stocks.join(", ")}, each in a ${AUTO_LP.bandLabel} Uniswap V4 range. Rebalancing (signalAll, executeReband, harvest, compound) runs automatically: a public keeper checks every 15 minutes, a stock out of range for ${AUTO_LP.breachDelaySec / 60} minutes is re-placed next to the price (no swaps), and fees compound daily. Holders never need to call it.
The retired V2 (${AUTO_LP_V2.vault}) and V1 (${AUTO_LP_V1.vault}) vaults are exit only: offer withdrawEth to existing holders and never a deposit.

## Minimal viem connection

Install: npm install viem

import { createPublicClient, createWalletClient, custom, http } from "viem";
import { defineChain } from "viem";
const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Robinhood Explorer", url: "https://robin.etherscan.io" } },
});
const publicClient = createPublicClient({ chain: robinhood, transport: http() });
const walletClient = createWalletClient({ chain: robinhood, transport: custom(window.ethereum) });

For CLI reads, use cast with --chain 4663 --rpc-url https://rpc.mainnet.chain.robinhood.com. For writes, use a connected wallet flow. Do not place private keys in commands, environment variables copied into chat, or project files.

## Common read interface

Every vault exposes ERC-20 balanceOf(address), totalSupply(), symbol(), decimals(), plus:
owner() returns (address)
paused() returns (bool)
constituents() returns (address[])
weth() returns (address)
freeBalance(address token) returns (uint256)
targetBps(address token) returns (uint16)
cashTargetBps() returns (uint16)
creatorFeeBps() returns (uint16)
protocolFeeBps() returns (uint16)
claimable(address user,address token) returns (uint256)

Read all values from one block number. Validate chainId == 4663, bytecode is present, constituents are unique and number 2–24, and the target weights plus cash reserve do not exceed 10,000 basis points.

## Holder actions on 696X and FAANGX V2

previewDeposit(uint256 ethIn) view returns (uint256 shares)
deposit(uint256 minShares,uint256 deadline) payable returns (uint256 shares)
withdraw(uint256 shares,uint256 minEthOut,uint256 deadline) returns (uint256 ethOut)
emergencyRedeemInKind(uint256 shares,address recipient)
claim(address token,address recipient)

Deposit flow: call previewDeposit at the latest block, choose a user-approved slippage floor, simulate deposit with the exact msg.value, then request the signature. Withdrawal flow: obtain a fresh complete holdings quote, compute a protected NAV floor, simulate the full withdrawal, then request the signature. If ETH exit cannot be simulated, offer emergencyRedeemInKind; it returns proportional tokens and cash and does not depend on swaps. Never silently lower a minimum after a failed simulation.

## Holder actions on atomic/proportional vaults

accountingMode() returns (bytes32)
planNonce() returns (uint256)
minFirstDeposit() returns (uint256)
quoteBuys(uint256[] budgets) payable
quoteWithdrawal(uint256 shares)
bootstrap(uint256[] floors,uint256 nonce,uint256 deadline) payable returns (uint256 shares)
depositExactShares(uint256 shares,uint256[] budgets,uint256[] floors,uint256 nonce,uint256 deadline) payable returns (uint256 refund)
withdraw(uint256 shares,uint256 minEthOut,uint256[] floors,uint256 nonce,uint256 deadline) returns (uint256 net)
emergencyRedeemInKind(uint256 shares,address recipient)
claim(address token,address recipient)

quoteBuys and quoteWithdrawal deliberately revert with typed BuyQuote and WithdrawalQuote results. Decode only those exact custom errors from a successful eth_call simulation. Bind every plan to one block, the current planNonce, the ordered constituent list, per-leg floors, a short deadline, and the exact ETH value. Re-read and re-simulate immediately before signing. Use bootstrap only when totalSupply is zero; otherwise use depositExactShares.

## Launch a new index

Factory reads:
bySlug(string) returns (address)
all(uint256) returns (address)
implementation() returns (address)
treasury() returns (address)
routePolicy() returns (address)
configIdByToken(address) returns (bytes32)

Factory write:
createAtomic(string slug,(address curator,address creator,address recipient,address treasury,string name,string symbol,uint16 creatorFee,uint16 protocolFee,uint16 cashBps,uint256 firstDeposit,string imageURI) init,bytes32[] configs,uint16[] weights) returns (address vault,address controller)

Protocol-owner-only factory administration also exposes registerConfigs(bytes32[] ids) and createAtomicBatch(...). Ordinary users and agents must use createAtomic and must never assume access to either owner-only function.

Launch rules:
- slug must be unused and normalized for the HOODX UI.
- choose 2–24 unique token addresses.
- resolve a nonzero configIdByToken for every token, preserving token/config order.
- weights must match config order; cashBps + sum(weights) must equal 10,000.
- recommended cash reserve is 2,500 bps; firstDeposit is 0.02 ETH.
- creatorFee is curator-selected within the factory limit; production protocolFee is 10 bps.
- curator and creator are the user's wallet. recipient is the fee recipient. treasury is the production treasury above.
- imageURI must be a durable HTTPS or IPFS URL no longer than 256 bytes.
- simulate createAtomic, show the predicted behavior and fees, request one signature, wait for the receipt, then resolve bySlug(slug) and verify controller.vault(), controller.curator(), vault.owner(), constituents, targets, fees, and image.
- creation makes an empty vault. Quote and simulate bootstrap separately before asking the curator to seed it.

## Curator and controller actions

controller.vault() returns (address)
controller.curator() returns (address)
controller.pendingCurator() returns (address)
controller.constituentsHash() returns (bytes32)
setPaused(bool value)
setTargets(uint16 cashBps,uint16[] weights)
addConstituent(bytes32 configId)
replaceConfig(bytes32 configId)
removeConstituent(address token)
emergencyUnwind(address token,uint256 amount,uint256 minOut,uint256 deadline) returns (uint256)
quoteRebalance(address token,bool buy,uint256 amount) payable
probeRebalance(address token,bool buy,uint256 amount,uint256 funding) returns (uint256 output)
probeExistingRebalance(address token,bool buy,uint256 amount)
rebalance(address token,bool buy,uint256 amount,uint256 minOut,uint256 minCashAfter,uint256 nonce,uint256 deadline)
atomicRebalance(uint16 cashBps,uint16[] weights,(address token,bool buy,uint256 amount,uint256 minOut)[] steps,bytes32 expectedConstituentsHash,uint256 expectedPlanNonce,uint256 minCashAfter,uint256 deadline)
setImageURI(string uri)
proposeCurator(address next)
acceptCurator()
releaseVault(address nextOwner)
cancelVaultRelease()

Curator combinations:
- set a new cash reserve and all asset weights without trading.
- execute one protected buy or sell.
- restore saved targets: sell overweight assets first, then buy underweight assets.
- deploy excess WETH into underweight assets while preserving the cash floor.
- harvest gains: sell only reconciled profitable sleeves into WETH.
- build a custom atomic plan with any valid sequence of sells followed by buys.
- pause/resume deposits, emergency-unwind one token, add an approved constituent, replace its route config, or remove a zero-balance constituent.
- update the index image, hand curation to a nominated wallet with propose/accept, or deliberately release vault ownership after showing the user the permanent control change.

For atomicRebalance, quote every leg at the same block. Order sells before buys. Use the exact current constituent order for weights. expectedConstituentsHash is keccak256(abi.encode(constituents)); expectedPlanNonce must equal the vault's latest planNonce. Set per-leg minimums, a final minCashAfter, and a short deadline. Simulate the complete atomic call. One failed route, stale nonce, changed basket, missed minimum, missed cash floor, or deadline failure must revert the entire action.

Only controller.curator() may use curator writes. Curators cannot transfer arbitrary user assets or bypass holder redemption rights. Do not call implementation, executor, policy, route-admin, ownership-transfer, or rescue functions unless the user explicitly requests protocol administration and the deployed role is independently verified.

## Standard share-token and metadata actions

All vault shares support balanceOf, allowance, approve, transfer and transferFrom. Use contractURI() for ERC-7572 metadata where available. A creator may update their allowed recipient and fee only through the deployed creator-economics function and within the protocol cap; discover and simulate the exact ABI for the vault version before offering that action. Never confuse share approval with approval of a basket constituent.

## Required transaction checklist

Before presenting any signature:
1. Identify chain, account, target contract, function, args, ETH value, and accounting mode.
2. Pin a recent block and read the full state from that block.
3. Validate addresses, bytecode, roles, constituent order, weights, config IDs, nonce, balances, and paused state.
4. Obtain fresh route quotes and independently calculate floors, cash reserve, fees, and expected shares/output.
5. Simulate the exact calldata from the signing account. Estimate gas and confirm the account can afford value plus gas.
6. Explain the expected portfolio result and every condition that can revert.
7. Ask for approval of that exact transaction. The connected wallet remains the final signer.
8. Wait for the receipt, require success, then re-read state and report the transaction hash and resulting balances.

Never invent a route, configuration ID, quote, token decimal count, or output. If any required check is unavailable, stop before signing and explain what is missing.`;
