import fs from "node:fs";

const CATALOG = "deployments/official-vault-catalog-2026-09-24.json";
const COMPANY_CAPS = "cache/scout/companies-market-cap-2026-09-24.csv";
const ETF_CAPS = "cache/scout/etf-market-cap-2026-09-24.csv";
const ASSET_SLEEVE_BPS = 7500;
const CASH_BPS = 2500;
const MIN_ASSET_BPS = 750;
const MAX_ASSET_BPS = 2500;
const ROUNDING_BPS = 5;

function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(value); value = ""; }
    else if (char === '\n') { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += char;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const headers = rows.shift();
  return rows.filter((item) => item.length === headers.length).map((item) => Object.fromEntries(headers.map((header, index) => [header, item[index]])));
}

const companies = parseCsv(fs.readFileSync(COMPANY_CAPS, "utf8"));
const etfs = parseCsv(fs.readFileSync(ETF_CAPS, "utf8"));
const companyBySymbol = new Map(companies.map((row) => [row.Symbol, row]));
const etfBySymbol = new Map(etfs.map((row) => [row.Symbol, row]));
const companyAliases = new Map([["GOOGL", "GOOG"], ["GLXY", "7LX.F"]]);
const etfSymbols = new Set(["SPY", "QQQ", "SGOV", "GLD", "SLV", "USO", "VTI"]);

function marketCap(symbol) {
  const source = etfSymbols.has(symbol) ? etfBySymbol : companyBySymbol;
  const lookup = companyAliases.get(symbol) || symbol;
  const row = source.get(lookup);
  const cap = Number(row?.marketcap);
  if (!Number.isFinite(cap) || cap <= 0) throw new Error(`Missing market cap for ${symbol}`);
  return { cap, sourceSymbol: lookup, sourceName: row.Name, sourceKind: etfSymbols.has(symbol) ? "ETF AUM" : "company market cap" };
}

function boundedSquareRootWeights(symbols, caps) {
  const weights = Array(symbols.length).fill(null);
  let remaining = ASSET_SLEEVE_BPS;
  let active = symbols.map((_, index) => index);
  while (active.length) {
    const score = active.reduce((sum, index) => sum + Math.sqrt(caps[index]), 0);
    let clamped = false;
    for (const index of [...active]) {
      const proposed = remaining * Math.sqrt(caps[index]) / score;
      const bound = proposed < MIN_ASSET_BPS ? MIN_ASSET_BPS : proposed > MAX_ASSET_BPS ? MAX_ASSET_BPS : null;
      if (bound !== null) {
        weights[index] = bound;
        remaining -= bound;
        active = active.filter((candidate) => candidate !== index);
        clamped = true;
      }
    }
    if (!clamped) {
      const activeScore = active.reduce((sum, index) => sum + Math.sqrt(caps[index]), 0);
      for (const index of active) weights[index] = remaining * Math.sqrt(caps[index]) / activeScore;
      break;
    }
  }
  const rounded = weights.map((weight) => Math.round(weight / ROUNDING_BPS) * ROUNDING_BPS);
  let delta = ASSET_SLEEVE_BPS - rounded.reduce((sum, weight) => sum + weight, 0);
  const direction = Math.sign(delta);
  const order = weights.map((weight, index) => ({ index, error: direction > 0 ? weight - rounded[index] : rounded[index] - weight }))
    .sort((a, b) => b.error - a.error || caps[b.index] - caps[a.index]);
  while (delta !== 0) {
    const candidate = order.find(({ index }) => direction > 0 ? rounded[index] + ROUNDING_BPS <= MAX_ASSET_BPS : rounded[index] - ROUNDING_BPS >= MIN_ASSET_BPS);
    if (!candidate) throw new Error("Unable to reconcile rounded smart weights");
    rounded[candidate.index] += direction * ROUNDING_BPS;
    delta -= direction * ROUNDING_BPS;
  }
  return rounded;
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
const capBySymbol = new Map();
for (const asset of catalog.assets) {
  const data = marketCap(asset.symbol);
  capBySymbol.set(asset.symbol, data.cap);
  asset.marketCapUsd = data.cap;
  asset.marketCapSourceSymbol = data.sourceSymbol;
  asset.marketCapSourceName = data.sourceName;
  asset.marketCapMeasure = data.sourceKind;
}

for (const vault of catalog.vaults) {
  const caps = vault.assets.map((symbol) => capBySymbol.get(symbol));
  vault.weightsBps = boundedSquareRootWeights(vault.assets, caps);
  const weightedAssetReturn = vault.assets.reduce((sum, symbol, index) => {
    const asset = catalog.assets.find((candidate) => candidate.symbol === symbol);
    return sum + Number(asset.return7dUsd) * vault.weightsBps[index] / ASSET_SLEEVE_BPS;
  }, 0);
  vault.model7dUsd = CASH_BPS / 10000 * catalog.assumptions.ethReturn7dUsd + ASSET_SLEEVE_BPS / 10000 * weightedAssetReturn;
  vault.model7dEth = ((1 + vault.model7dUsd / 100) / (1 + catalog.assumptions.ethReturn7dUsd / 100) - 1) * 100;
  vault.weighting = "square-root market cap";
}

catalog.status = "route-and-fork-lifecycle-qualified-pending-live-admission";
catalog.sources.marketCaps = "https://companiesmarketcap.com/?download=csv";
catalog.sources.etfAum = "https://companiesmarketcap.com/etfs/largest-etfs-by-marketcap/?download=csv";
catalog.assumptions = {
  ...catalog.assumptions,
  cashTargetBps: CASH_BPS,
  assetSleeveBps: ASSET_SLEEVE_BPS,
  weighting: "square-root market cap with bounded concentration",
  minimumAssetBps: MIN_ASSET_BPS,
  maximumAssetBps: MAX_ASSET_BPS,
  roundingBps: ROUNDING_BPS,
  initialEntryUsesTargetWeights: true,
};
catalog.limitations = catalog.limitations.map((line) => line.replace("A route is not approved until the pinned route passes buy, sell, deposit, withdrawal and atomic rebalance tests on a current fork.", "Pinned routes passed buy, sell, deposit and full ETH withdrawal tests on a current fork; production admission remains a separate signed action."));
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");
for (const vault of catalog.vaults) console.log(`${vault.symbol}: ${vault.assets.map((symbol, index) => `${symbol} ${vault.weightsBps[index] / 100}%`).join(" · ")} · 7D ETH ${vault.model7dEth.toFixed(2)}%`);
