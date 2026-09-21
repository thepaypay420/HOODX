"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatEther, formatUnits, parseAbi, type Address } from "viem";
import { TokenArt } from "@/components/TokenArt";
import { publicClient } from "@/lib/wallet";

const abi = parseAbi(["function constituents() view returns (address[])", "function weth() view returns (address)", "function targetBps(address) view returns (uint16)", "function cashTargetBps() view returns (uint16)", "function freeBalance(address) view returns (uint256)", "function creatorFeeBps() view returns (uint16)", "function protocolFeeBps() view returns (uint16)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
type Row = { token: Address; symbol: string; weight: number; balance: string; rawBalance: bigint; cash: boolean };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const amount = (v?: bigint) => v === undefined ? "—" : Number(formatEther(v)).toLocaleString(undefined, { maximumFractionDigits: 5 });

export function VaultOverview({ vault, slug, shares, assets, supply, paused, connected, curator, children }: { vault: Address; slug: string; shares?: bigint; assets?: bigint; supply?: bigint; paused?: boolean; connected: boolean; curator?: boolean; children?: ReactNode }) {
  const [data, setData] = useState<{ vault: Address; rows: Row[]; fee: number }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    async function load() {
      const [tokens, weth, cash, creator, protocol] = await Promise.all([
        publicClient.readContract({ address: vault, abi, functionName: "constituents" }),
        publicClient.readContract({ address: vault, abi, functionName: "weth" }),
        publicClient.readContract({ address: vault, abi, functionName: "cashTargetBps" }),
        publicClient.readContract({ address: vault, abi, functionName: "creatorFeeBps" }),
        publicClient.readContract({ address: vault, abi, functionName: "protocolFeeBps" }),
      ]);
      const rows = await Promise.all([...tokens, weth].map(async token => {
        const isCash = token.toLowerCase() === weth.toLowerCase();
        const [symbol, decimals, weight, balance] = await Promise.all([
          publicClient.readContract({ address: token, abi, functionName: "symbol" }).catch(() => short(token)),
          publicClient.readContract({ address: token, abi, functionName: "decimals" }).catch(() => undefined),
          isCash ? Promise.resolve(cash) : publicClient.readContract({ address: vault, abi, functionName: "targetBps", args: [token] }),
          publicClient.readContract({ address: vault, abi, functionName: "freeBalance", args: [token] }),
        ]);
        return { token, symbol, weight, cash: isCash, rawBalance: balance, balance: decimals === undefined ? "Unavailable" : Number(formatUnits(balance, decimals)).toLocaleString(undefined, { maximumFractionDigits: 5 }) };
      }));
      if (active) setData({ vault, rows, fee: (creator + protocol) / 100 });
    }
    void load().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [vault, assets, supply]);
  const current = data?.vault === vault ? data : undefined;
  return <>
    <div className="vault-breadcrumb"><a href="/explore">Explore indexes</a><span>/</span><span>{slug.toUpperCase()}</span></div>
    <header className="vault-hero desk">
      <div className="vault-identity"><TokenArt slug={slug} priority /><div><p className="vault-eyebrow">HOODX / ROBINHOOD CHAIN</p><h1>{slug.toUpperCase()}<span>INDEX</span></h1><p className="vault-subtitle">{slug === "696x" ? "The culture. The conviction. One basket." : slug === "faangx" ? "Big tech conviction, held together." : "Your community. One shared basket."}</p></div></div>
      <div className="vault-hero-footer"><span className="vault-tag"><i />{paused === undefined ? "Reading vault" : paused ? "Deposits paused" : "Open for deposits"}</span><a href={`https://robin.etherscan.io/address/${vault}`} target="_blank" rel="noreferrer">View contract {short(vault)} ↗</a><a href="#wallet-actions">Your wallet ↓</a>{curator && <a href="#curator-workspace">Manage vault ↓</a>}<span className="vault-version">V2</span></div>
    </header>
    <div className="vault-stats">
      <div><p>Vault value</p><strong>{amount(assets)} <small>ETH</small></strong><span>On-chain asset value</span></div>
      <div><p>Your shares</p><strong>{connected ? amount(shares) : "—"}</strong><span>{connected ? slug.toUpperCase() + " in your wallet" : "Connect to see your position"}</span></div>
      <div><p>Assets held</p><strong>{current ? current.rows.filter(r => !r.cash && r.rawBalance > 0n).length : "—"} <small>assets</small></strong><span>Plus a WETH cash reserve</span></div>
      <div><p>Deposit fee</p><strong>{current ? current.fee.toFixed(2) : "—"}<small>%</small></strong><span>Creator + protocol</span></div>
    </div>
    {children}
    <section className="vault-basket holo"><div className="vault-section-heading"><div><p className="vault-eyebrow">LOOK INSIDE</p><h2>Current holdings.</h2></div><span className="vault-tag">Live on-chain targets</span></div>
      {current ? <>{!current.rows.some(r => r.rawBalance > 0n) && <p className="vault-footnote">No assets held yet.</p>}<div className="vault-allocation" aria-label="Target allocation">{current.rows.filter(r => r.weight > 0).map((r, i) => <div key={r.token} title={`${r.symbol}: ${r.weight / 100}%`} style={{ flex: r.weight, background: `hsl(${165 + i * 13} 45% ${45 + i % 3 * 9}%)` }} />)}</div><div className="vault-table-scroll"><table className="vault-table"><thead><tr><th>Asset</th><th>Target</th><th>Vault balance</th></tr></thead><tbody>{current.rows.filter(r => r.rawBalance > 0n).map((r, i) => <tr key={r.token}><td><a href={`https://robin.etherscan.io/token/${r.token}`} target="_blank" rel="noreferrer"><span className="vault-coin" style={{ color: `hsl(${165 + i * 13} 60% 70%)` }}>{r.symbol.slice(0, 2)}</span><span>{r.symbol}<small>{r.cash ? "Cash reserve" : short(r.token)}</small></span></a></td><td>{(r.weight / 100).toFixed(2)}%<span className="vault-weight"><i style={{ width: `${r.weight / 100}%` }} /></span></td><td>{r.balance}</td></tr>)}</tbody></table></div><p className="vault-footnote">Only nonzero holdings are shown; the asset count excludes WETH. Targets are intended allocations, not current portfolio weights. Balances exclude reserved claims.</p></> : <p className="vault-footnote">{failed ? "Basket data is temporarily unavailable. Transaction and recovery controls remain below." : "Reading the basket from Robinhood Chain…"}</p>}
    </section>
  </>;
}
