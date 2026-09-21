"use client";
import { useEffect, useState } from "react";
import { compactCap, type HoldingMarket } from "@/lib/holdingMarket";

export type HoldingRow = { token: string; symbol: string; weight: number; balance: string; rawBalance: bigint; cash: boolean };
type Markets = Record<string, HoldingMarket | null>;
const cache = new Map<string, { at: number; value: Promise<Markets> }>();
function loadMarkets(key: string) {
  const old = cache.get(key);
  if (old && Date.now() - old.at < 900_000) return old.value;
  const value = fetch(`/api/holding-market?tokens=${key}`).then(r => { if (!r.ok) throw new Error("Unavailable"); return r.json() as Promise<Markets>; });
  if (cache.size > 64) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}
function CoinImage({ row, image }: { row: HoldingRow; image?: string | null }) {
  const [failed, setFailed] = useState(false);
  return <span className="holdings-icon">{image && !failed ? <img src={image} alt="" width="28" height="28" loading="lazy" onError={() => setFailed(true)} /> : row.symbol.slice(0, 2)}</span>;
}
export function HoldingsBoard({ rows, slug }: { rows: HoldingRow[]; slug: string }) {
  const [markets, setMarkets] = useState<Markets>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState("");
  const key = rows.filter(r => !r.cash && r.rawBalance > 0n).map(r => r.token.toLowerCase()).sort().join(",");
  useEffect(() => {
    let active = true; setMarkets({});
    const refresh = () => { if (key && document.visibilityState !== "hidden") void loadMarkets(key).then(m => { if (active) setMarkets(m); }).catch(() => {}); };
    refresh();
    const timer = setInterval(refresh, 900_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [key]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const held = rows.filter(r => !r.cash && r.rawBalance > 0n).sort((a, b) => (markets[b.token.toLowerCase()]?.marketCap || 0) - (markets[a.token.toLowerCase()]?.marketCap || 0) || a.symbol.localeCompare(b.symbol));
  const cash = rows.find(r => r.cash && r.rawBalance > 0n);
  const times = held.flatMap(r => markets[r.token.toLowerCase()] ? [markets[r.token.toLowerCase()]!.updatedAt] : []);
  const oldest = times.length ? Math.min(...times) : undefined;
  const stamp = oldest ? new Date(oldest).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Unavailable";
  async function generate() {
    setBusy(true); setError("");
    try {
      const { renderHoldingsPng } = await import("@/lib/holdingsPng");
      const blob = await renderHoldingsPng({ slug, rows: held, cash, markets, oldest });
      setPreview(URL.createObjectURL(blob));
    } catch { setError("Could not create the image. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="vault-basket holo holdings-board">
    <div className="vault-section-heading"><div><p className="vault-eyebrow">THE CONVICTION LIST</p><h2>Current holdings.</h2></div><button className="vault-button" onClick={generate} disabled={busy || !held.length}>{busy ? "Creating image…" : "Share holdings ↗"}</button></div>
    <div className="holdings-caption"><span>{held.length} assets · Ranked by market cap</span><span>USD market caps</span></div>
    <div className="vault-table-scroll"><table className="vault-table holdings-table"><thead><tr><th>#</th><th>Token</th><th>Market cap</th><th>Target</th><th className="holdings-balance">Held</th></tr></thead><tbody>{held.map((row, i) => { const market = markets[row.token.toLowerCase()]; return <tr key={row.token}><td>{i + 1}</td><td><a href={`https://robin.etherscan.io/token/${row.token}`} target="_blank" rel="noreferrer"><CoinImage row={row} image={market?.image}/><span>{row.symbol}<small>{market?.name || `${row.token.slice(0, 6)}…${row.token.slice(-4)}`}</small></span></a></td><td className="holdings-cap">{compactCap(market?.marketCap)}</td><td>{(row.weight / 100).toFixed(2)}%</td><td className="holdings-balance">{row.balance}</td></tr>; })}</tbody></table></div>
    {!held.length && <p className="vault-footnote">No assets held yet.</p>}
    {cash && <div className="holdings-cash"><span>WETH <small>Cash reserve</small></span><span>{cash.balance} WETH <small>{(cash.weight / 100).toFixed(2)}% target</small></span></div>}
    <div className="holdings-signoff"><span>HOODX / ROBINHOOD CHAIN</span><span>One token. Up to 24 assets.</span></div>
    <p className="vault-footnote">Market caps: DEX Screener · {stamp}{oldest && Date.now() - oldest > 1_800_000 ? " · Delayed data" : ""}. Cached for 15 minutes; missing values shown as —. Targets are intended allocations, not current weights. Only nonzero holdings shown; reserved claims excluded.</p>
    {error && <p role="alert">{error}</p>}
    {preview && <div className="holdings-preview"><div><strong>Your share card</strong><button className="vault-button" onClick={() => setPreview(undefined)}>Close preview</button></div><img src={preview} alt={`${slug.toUpperCase()} branded holdings share card`} /><a className="vault-button" href={preview} download={`HOODX-${slug}-holdings.png`}>Download PNG</a><p className="vault-footnote">Ready to attach to your post on X. Wallet balances and personal returns are never included.</p></div>}
  </section>;
}
