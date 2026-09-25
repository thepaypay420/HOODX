"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatEther, formatUnits, parseAbi, type Address } from "viem";
import { HoldingsBoard } from "@/components/HoldingsBoard";
import { TokenArt } from "@/components/TokenArt";

import { VaultRecentActivity } from "@/components/VaultRecentActivity";
import { publicClient } from "@/lib/wallet";

import { addVaultAssetToWallet } from "@/lib/walletAsset";

import { vaultImage } from "@/lib/vaults";

const abi = parseAbi(["function constituents() view returns (address[])", "function weth() view returns (address)", "function targetBps(address) view returns (uint16)", "function cashTargetBps() view returns (uint16)", "function freeBalance(address) view returns (uint256)", "function creatorFeeBps() view returns (uint16)", "function protocolFeeBps() view returns (uint16)", "function symbol() view returns (string)", "function imageURI() view returns (string)", "function decimals() view returns (uint8)"]);
type Row = { token: Address; symbol: string; weight: number; balance: string; rawBalance: bigint; cash: boolean };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const amount = (v?: bigint) => v === undefined ? "—" : Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 5 });

export function VaultOverview({ vault, slug, shares, assets, quoteTime, valuationFailed, supply, paused, connected, curator, children }: { vault: Address; slug: string; shares?: bigint; assets?: bigint; quoteTime?: number; valuationFailed?: boolean; supply?: bigint; paused?: boolean; connected: boolean; curator?: boolean; children?: ReactNode }) {
  const [data, setData] = useState<{ vault: Address; rows: Row[]; fee: number; symbol: string; image: string }>();
  const [failed, setFailed] = useState(false);

  const [walletLabel, setWalletLabel] = useState("Add token to wallet +");
  useEffect(() => {
    let active = true;
    setFailed(false);
    async function load() {
      const [tokens, weth, cash, creator, protocol, vaultSymbol, imageURI] = await Promise.all([
        publicClient.readContract({ address: vault, abi, functionName: "constituents" }),
        publicClient.readContract({ address: vault, abi, functionName: "weth" }),
        publicClient.readContract({ address: vault, abi, functionName: "cashTargetBps" }),
        publicClient.readContract({ address: vault, abi, functionName: "creatorFeeBps" }),
        publicClient.readContract({ address: vault, abi, functionName: "protocolFeeBps" }),

        publicClient.readContract({ address: vault, abi, functionName: "symbol" }).catch(() => slug.toUpperCase()),

        publicClient.readContract({ address: vault, abi, functionName: "imageURI" }).catch(() => ""),
      ]);
      const rows = await Promise.all([...tokens, weth].map(async token => {
        const isCash = token.toLowerCase() === weth.toLowerCase();
        const [symbol, decimals, weight, balance] = await Promise.all([
          publicClient.readContract({ address: token, abi, functionName: "symbol" }).catch(() => short(token)),
          publicClient.readContract({ address: token, abi, functionName: "decimals" }).catch(() => undefined),
          isCash ? Promise.resolve(cash) : publicClient.readContract({ address: vault, abi, functionName: "targetBps", args: [token] }),
          publicClient.readContract({ address: vault, abi, functionName: "freeBalance", args: [token] }),
        ]);
        return { token, symbol: String(symbol).slice(0,24), weight, cash: isCash, rawBalance: balance, balance: decimals === undefined ? "Unavailable" : Number(formatUnits(balance, decimals)).toLocaleString(undefined, { maximumFractionDigits: 5 }) };
      }));
      if (active) setData({ vault, rows, fee: (creator + protocol) / 100, symbol: vaultSymbol, image: imageURI || vaultImage(slug) });
    }
    void load().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [vault, assets, supply]);
  const current = data?.vault === vault ? data : undefined;
  return <>
    <div className="vault-breadcrumb"><a href="/explore">Explore indexes</a><span>/</span><span>{slug.toUpperCase()}</span></div>
    <header className="vault-hero desk">
      <div className="vault-hero-main">
        <div className="vault-identity"><TokenArt slug={slug} priority /><div><p className="vault-eyebrow">HOODX / ROBINHOOD CHAIN</p><h1>{slug.toUpperCase()}<span>INDEX</span></h1><p className="vault-subtitle">{slug === "696x" ? "The culture. The conviction. One basket." : slug === "faangx" ? "Big tech conviction, held together." : "Your community. One shared basket."}</p></div></div>
        <VaultRecentActivity slug={slug} />
      </div>
      <div className="vault-hero-footer"><span className="vault-tag"><i />{paused === undefined ? "Reading vault" : paused ? "Deposits paused" : "Open for deposits"}</span><a href={`https://robin.etherscan.io/address/${vault}`} target="_blank" rel="noreferrer">View contract {short(vault)} ↗</a><button type="button" onClick={async()=>{if(!current)return;setWalletLabel(await addVaultAssetToWallet({address:vault,symbol:current.symbol,image:current.image})?"Added to wallet ✓":"Wallet will index it automatically");}}>{walletLabel}</button><a href="#wallet-actions">Your wallet ↓</a>{curator && <a href="#curator-workspace">Manage vault ↓</a>}<span className="vault-version">V2</span></div>
    </header>
    <div className="vault-stats">
      <div><p>{quoteTime ? "Estimated vault value" : "Vault value"}</p><strong>{amount(assets)} <small>ETH</small></strong><span>{quoteTime ? `Uniswap quotes · ${new Date(quoteTime).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}` : valuationFailed ? "Valuation temporarily unavailable" : "On-chain asset value"}</span></div>
      <div><p>Your shares</p><strong>{connected ? amount(shares) : "—"}</strong><span>{connected ? slug.toUpperCase() + " in your wallet" : "Connect to see your position"}</span></div>
      <div><p>Assets held</p><strong>{current ? current.rows.filter(r => !r.cash && r.rawBalance > 0n).length : "—"} <small>assets</small></strong><span>Plus a WETH cash reserve</span></div>
      <div><p>Deposit fee</p><strong>{current ? current.fee.toFixed(2) : "—"}<small>%</small></strong><span>Creator + protocol</span></div>
    </div>
    {valuationFailed && !quoteTime && <p className="vault-footnote" role="status">The vault cannot currently validate all asset prices. Value and returns are unavailable until pricing recovers; this does not mean your holdings are zero. Deposits and ETH withdrawals may also fail their pricing checks. Token balances and direct asset redemption remain available below.</p>}
    {quoteTime && <p className="vault-footnote">Estimated from quotes to sell the current holdings, plus cash. Includes quoted pool fees and price impact; excludes gas. Routes are quoted separately, so this is not a guaranteed full-basket withdrawal amount. Contract pricing is currently unavailable, so ETH transactions may still fail validation.</p>}
    {children}
    {current ? <HoldingsBoard rows={current.rows} slug={slug} /> : <section className="vault-basket holo"><p className="vault-footnote">{failed ? "Basket data is temporarily unavailable. Transaction and recovery controls remain below." : "Reading the basket from Robinhood Chain…"}</p></section>}
  </>;
}
