"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatEther, formatUnits, parseAbi, type Address } from "viem";
import { HoldingsBoard } from "@/components/HoldingsBoard";
import { TokenArt } from "@/components/TokenArt";
import { publicClient } from "@/lib/wallet";
import { addVaultAssetToWallet } from "@/lib/walletAsset";
import { activityTransactionUrl, recentVaultActivity } from "@/lib/vaultActivity";
import { launchReturnBps } from "@/lib/v2Performance";
import { vaultImage } from "@/lib/vaults";

const abi = parseAbi(["function constituents() view returns (address[])", "function weth() view returns (address)", "function targetBps(address) view returns (uint16)", "function cashTargetBps() view returns (uint16)", "function freeBalance(address) view returns (uint256)", "function creatorFeeBps() view returns (uint16)", "function protocolFeeBps() view returns (uint16)", "function symbol() view returns (string)", "function imageURI() view returns (string)", "function decimals() view returns (uint8)"]);
type Row = { token: Address; symbol: string; weight: number; balance: string; rawBalance: bigint; cash: boolean };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const amount = (v?: bigint) => v === undefined ? "—" : Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 4 });
const percent = (bps?: bigint) => bps === undefined ? "—" : `${bps > 0n ? "+" : ""}${(Number(bps) / 100).toFixed(2)}%`;
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The vault page: what it is, how it is doing and what is inside. `aside` is the deposit / withdraw card. */
export function VaultOverview({ vault, slug, assets, quoteTime, valuationFailed, supply, paused, curator, proportional, aside, children }: { vault: Address; slug: string; assets?: bigint; quoteTime?: number; valuationFailed?: boolean; supply?: bigint; paused?: boolean; curator?: boolean; proportional?: boolean; aside?: ReactNode; children?: ReactNode }) {
  const [data, setData] = useState<{ vault: Address; rows: Row[]; fee: number; symbol: string; image: string }>();
  const [failed, setFailed] = useState(false);
  const [walletLabel, setWalletLabel] = useState("Add to wallet");
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
  const launch = assets !== undefined && supply !== undefined ? launchReturnBps(assets, supply) : undefined;
  const [activity] = recentVaultActivity(slug);
  const status = paused === undefined ? "Loading" : paused ? "Deposits paused" : valuationFailed ? "ETH paths paused" : "Open";
  return <>
    <div className="vault-breadcrumb"><a href="/explore">Explore indexes</a><span>/</span><span>{slug.toUpperCase()}</span></div>
    <div className="vp-layout">
      <header className="vp-hero desk">
        <div className="vp-id">
          <TokenArt slug={slug} priority />
          <div><h1>{slug.toUpperCase()}</h1><p>{slug === "696x" ? "The culture. The conviction. One basket." : slug === "faangx" ? "Big tech conviction, held together." : "Your community. One shared basket."}</p></div>
          <span className={`vp-status${status === "Open" ? "" : " is-quiet"}`}><i />{status}</span>
        </div>
        <dl className="vp-facts">
          <div><dt>Since launch</dt><dd className={launch === undefined ? "" : launch < 0n ? "is-down" : "is-up"}>{percent(launch)}</dd></div>
          <div><dt>Vault value</dt><dd>{amount(assets)}<small>ETH</small></dd></div>
          <div><dt>Deposit fee</dt><dd>{current ? current.fee.toFixed(2) : "—"}<small>%</small></dd></div>
        </dl>
        {valuationFailed && !quoteTime && <p className="vp-hero-note" role="status">Prices can&apos;t be validated right now, so value and returns are hidden. Your holdings are unaffected and you can still exit as tokens and cash.</p>}
        {curator && <a className="vp-manage" href="#curator-workspace">Manage vault ↓</a>}
      </header>
      {children}
      <aside className="vp-side">{aside}</aside>
      {current ? <HoldingsBoard rows={current.rows} slug={slug} /> : <section className="vault-basket holo"><p className="vault-footnote">{failed ? "Basket data is temporarily unavailable. Transaction and recovery controls remain available." : "Reading the basket from Robinhood Chain…"}</p></section>}
      <details className="vp-details holo">
        <summary>Vault details<span>Contract, fees and how numbers are calculated</span></summary>
        <dl>
          <div><dt>Contract</dt><dd><a href={`https://robin.etherscan.io/address/${vault}`} target="_blank" rel="noreferrer">{short(vault)} ↗</a></dd></div>
          <div><dt>Network</dt><dd>Robinhood Chain</dd></div>
          <div><dt>Vault type</dt><dd>{proportional ? "V3 · oracle-free" : "V2"}</dd></div>
          <div><dt>Deposit fee</dt><dd>{current ? `${current.fee.toFixed(2)}% · creator + protocol` : "—"}</dd></div>
          <div><dt>{current?.symbol ?? slug.toUpperCase()} token</dt><dd><button type="button" onClick={async()=>{if(!current)return;setWalletLabel(await addVaultAssetToWallet({address:vault,symbol:current.symbol,image:current.image})?"Added ✓":"Your wallet will index it automatically");}}>{walletLabel}</button></dd></div>
          {activity && <div><dt>Latest curator action</dt><dd><a href={activityTransactionUrl(activity.txHash)} target="_blank" rel="noreferrer">{activity.title} · {activity.result} · {day.format(new Date(activity.confirmedAt))} ↗</a></dd></div>}
        </dl>
        <p><b>Vault value.</b> {quoteTime ? `Estimated at ${new Date(quoteTime).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} from live quotes to sell every holding, plus cash. Includes pool fees and price impact; excludes gas. Each route is quoted separately, so it is not a guaranteed full-basket withdrawal amount.` : "The on-chain value of every holding plus cash."} {proportional ? "This vault needs no price oracle: deposits buy your exact share of every holding and withdrawals sell it at live prices." : quoteTime ? "Contract pricing is currently unavailable, so ETH transactions may still fail validation." : ""}</p>
        <p><b>Returns.</b> Since launch compares the current ETH value per share with the 0.04 ETH launch price. Your return is your current share value plus ETH withdrawals minus gross deposits, divided by gross deposits. It includes deposit fees and excludes gas. Transferred shares and exits taken as tokens need a separate cost basis.</p>
      </details>
    </div>
  </>;
}
