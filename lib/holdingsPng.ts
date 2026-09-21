import type { HoldingRow } from "@/components/HoldingsBoard";
import { compactCap, type HoldingMarket } from "./holdingMarket";
async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => { const image = new Image(); const timer = window.setTimeout(() => resolve(null), 6000); image.onload = () => { clearTimeout(timer); resolve(image); }; image.onerror = () => { clearTimeout(timer); resolve(null); }; image.src = src; });
}
export async function renderHoldingsPng({ slug, rows, cash, markets, oldest }: { slug: string; rows: HoldingRow[]; cash?: HoldingRow; markets: Record<string, HoldingMarket | null>; oldest?: number }) {
  await document.fonts.ready;
  const styles = getComputedStyle(document.body);
  const ui = styles.getPropertyValue("--font-ui").trim() || "sans-serif";
  const script = styles.getPropertyValue("--font-script").trim() || "cursive";
  await Promise.all([document.fonts.load(`600 42px ${ui}`), document.fonts.load(`600 48px ${script}`)]);
  const images = await Promise.all(rows.map(r => markets[r.token.toLowerCase()]?.image ? loadImage(markets[r.token.toLowerCase()]!.image!) : Promise.resolve(null)));
  const logo = await loadImage("/hoodx-mark.png");
  const width = 1200, height = 350 + rows.length * 66 + (cash ? 56 : 0);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
  const ctx: CanvasRenderingContext2D = context;
  ctx.fillStyle = "#091211"; ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(980, 0, 0, 980, 0, 650); glow.addColorStop(0, "#194d47"); glow.addColorStop(1, "#091211"); ctx.fillStyle = glow; ctx.fillRect(0, 0, width, 220);
  function text(value: string, x: number, y: number, size = 22, color = "#ebf7f4", align: CanvasTextAlign = "left", family = ui) { ctx.font = `500 ${size}px ${family}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(value, x, y); }
  function fit(value: string, max: number) { while (ctx.measureText(value).width > max && value.length > 1) value = value.slice(0, -2) + "…"; return value; }
  if (logo) ctx.drawImage(logo, 48, 35, 40, 40);
  text("HOODX", 100, 65, 27); text("ROBINHOOD CHAIN", 1152, 65, 17, "#82b4aa", "right");
  text(`${slug.toUpperCase()} / The conviction list.`, 48, 132, 42);
  text(`${rows.length} assets. One basket.`, 48, 171, 23, "#8baba3");
  text("#", 48, 210, 16, "#8baba3"); text("TOKEN", 140, 210, 16, "#8baba3"); text("MARKET CAP / USD", 943, 210, 16, "#8baba3", "right"); text("TARGET", 1152, 210, 16, "#8baba3", "right");
  rows.forEach((row, i) => { const y = 240 + i * 66; ctx.fillStyle = i % 2 ? "#101e1b" : "#0d1917"; ctx.fillRect(32, y, 1136, 64); text(String(i + 1).padStart(2, "0"), 48, y + 40, 18, "#78988f"); const image = images[i]; if (image) { ctx.save(); ctx.beginPath(); ctx.roundRect(94, y + 13, 38, 38, 9); ctx.clip(); ctx.drawImage(image, 94, y + 13, 38, 38); ctx.restore(); } else text(row.symbol.slice(0, 2), 97, y + 40, 18, "#4dd4c1"); text(row.symbol.slice(0, 24), 148, y + 40, 23); const market = markets[row.token.toLowerCase()]; ctx.font = `500 18px ${ui}`; const name = fit(market?.name || "", 270); text(name, 440, y + 40, 18, "#8baba3"); text(compactCap(market?.marketCap), 943, y + 40, 26, "#50d2bf", "right"); text(`${(row.weight / 100).toFixed(2)}%`, 1152, y + 40, 22, "#c1d6cf", "right"); });
  let y = 240 + rows.length * 66;
  if (cash) { text("WETH / Cash reserve", 48, y + 36, 20, "#8baba3"); text(`${(cash.weight / 100).toFixed(2)}% target`, 1152, y + 36, 20, "#8baba3", "right"); y += 56; }
  text("xhoodindex.com", 48, y + 45, 24); text("One token. Shared conviction.", 1152, y + 48, 43, "#50d2bf", "right", script);
  text(`DEX Screener • ${oldest ? new Date(oldest).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "Market caps unavailable"} • Targets, not current weights`, 48, y + 82, 15, "#8baba3");
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG failed")), "image/png"));
}
