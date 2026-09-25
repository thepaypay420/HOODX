"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseAbi, parseEther, type Address } from "viem";
import { TokenArt } from "@/components/TokenArt";
import { AddName } from "@/components/AddName";
import { productionV2Factory, productionV2Treasury, verifiedV2Vaults, v2FactoryAbi } from "@/lib/v2";
import { INDEX_CATALOG, tier, type Coin } from "@/lib/catalog";
import { robinhood } from "@/lib/chain";
import { CREATOR_FEE_BPS, PROTOCOL_FEE_BPS } from "@/lib/config";
import { fmtUsd, isAddress, okUserSlug, toSlug } from "@/lib/format";
import { lookupIndexCoin } from "@/lib/lookup";
import { saveDraft, savePayout } from "@/lib/packs";
import { DEFAULT_VAULT_WALLET_IMAGE, fileToTokenImage, saveTokenImage, walletImageUri } from "@/lib/tokenImage";
import { publicClient, useWallet } from "@/lib/wallet";
import { distribute } from "@/lib/curatorPlanner";
import { percentBps } from "@/lib/v2Allocation";
import { atomicFactoryAbi, atomicFactoryAddress } from "@/lib/atomicFactory";
import { addVaultAssetToWallet } from "@/lib/walletAsset";

export function Forge() {
  const router = useRouter();
  const { address, chainId, walletClient, connect, connecting } = useWallet();
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [feeBps, setFeeBps] = useState(CREATOR_FEE_BPS);
  const [payout, setPayout] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [imageSrc, setImageSrc] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [extra, setExtra] = useState<Coin[]>([]);
  const [cash, setCash] = useState("25.00");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [allocationMode, setAllocationMode] = useState<"equal" | "custom">("equal");
  const launchFactory = atomicFactoryAddress ?? productionV2Factory;
  const live = isAddress(launchFactory);
  const slugOk = okUserSlug(slug);
  const allocation = useMemo(() => {
    try {
      const cashBps = percentBps(cash);
      const weightsBps = picked.map((token) => percentBps(weights[token.toLowerCase()] || "0"));
      return { cashBps, weightsBps, total: cashBps + weightsBps.reduce((a, b) => a + b, 0), error: "" };
    } catch (e) {
      return { cashBps: 0, weightsBps: [] as number[], total: 0, error: e instanceof Error ? e.message : "Invalid allocation" };
    }
  }, [cash, picked, weights]);
  const ready = picked.length >= 2 && name.trim().length >= 2 && symbol.length >= 2 && slugOk && allocation.total === 10_000;

  useEffect(() => {
    if (!picked.length) return;
    setWeights((current) => {
      try {
        const proposed = picked.map((token) => current[token.toLowerCase()] || "1.00");
        const normalized = distribute(cash, proposed, proposed.map(() => false), allocationMode === "equal");
        return Object.fromEntries(picked.map((token, i) => [token.toLowerCase(), normalized[i]]));
      } catch {
        return current;
      }
    });
  }, [picked, cash, allocationMode]);

  function persist() {
    if (!slugOk) return;
    saveDraft({
      slug,
      name: name.trim() || symbol,
      symbol,
      tokens: picked,
      feeBps,
      payout: payout || undefined,
      cashBps: allocation.cashBps,
      weightsBps: Object.fromEntries(picked.map((token, i) => [token.toLowerCase(), allocation.weightsBps[i] || 0])),
      createdAt: Date.now(),
    });
    if (payout) savePayout(slug, payout);
    if (imageSrc) saveTokenImage(slug, imageSrc);
  }

  function toggle(token: string) {
    setPicked((cur) => {
      const has = cur.includes(token);
      if (has) return cur.filter((x) => x !== token);
      if (cur.length >= 24) return cur;
      return [...cur, token];
    });
  }

  async function launch() {
    persist();
    if (!walletClient || !address || !live) return;
    setBusy(true);
    setErr(null);
    try {
      const coins = [];
      for (const t of picked) {
        coins.push(await lookupIndexCoin(t));
      }
      const tokens = coins.map((c) => c.token as Address);
      const recipient = payout && isAddress(payout) ? (payout as Address) : address;
      // Every index token launches with wallet-safe image metadata. Curators can
      // provide custom HTTPS/IPFS artwork; the HOODX mark is the stable fallback.
      const onChainImage = walletImageUri(imageUrl) || DEFAULT_VAULT_WALLET_IMAGE;
      if (chainId !== robinhood.id) throw new Error("Switch your wallet to Robinhood Chain.");
      if (new TextEncoder().encode(onChainImage).length > 256) throw new Error("Use an HTTPS or IPFS image URL of at most 256 bytes.");
      const zeroConfig = `0x${"0".repeat(64)}`;
      const atomicFactory = atomicFactoryAddress;
      const configs = atomicFactory
        ? await Promise.all(tokens.map(async token => {
            const id = await publicClient.readContract({ address: atomicFactory, abi: atomicFactoryAbi, functionName: "configIdByToken", args: [token] });
            if (id === zeroConfig) throw new Error("A selected asset does not yet have a reviewed successor route.");
            return id;
          }))
        : await Promise.all(tokens.map(async token => {
            const configAbi = parseAbi(["function configId(address) view returns (bytes32)"]);
            for (const vault of Object.values(verifiedV2Vaults)) {
              const id = await publicClient.readContract({ address: vault, abi: configAbi, functionName: "configId", args: [token] });
              if (id !== zeroConfig) return id;
            }
            throw new Error("A selected asset does not yet have an approved route.");
          }));
      if (allocation.total !== 10_000) throw new Error("Allocation must total exactly 100%.");
      const launchWeights = picked.map((token) => percentBps(weights[token.toLowerCase()] || "0"));
      const init = { curator: address, creator: address, recipient, treasury: productionV2Treasury, name: name.trim(), symbol, creatorFee: feeBps, protocolFee: 10, cashBps: allocation.cashBps, firstDeposit: parseEther("0.02"), imageURI: onChainImage };
      let hash: `0x${string}`;
      if (atomicFactory) {
        const { request } = await publicClient.simulateContract({
          account: address,
          address: atomicFactory,
          abi: atomicFactoryAbi,
          functionName: "createAtomic",
          args: [slug, init, configs, launchWeights],
          chain: robinhood,
        });
        hash = await walletClient.writeContract(request);
      } else {
        const { request } = await publicClient.simulateContract({
          account: address,
          address: productionV2Factory,
          abi: v2FactoryAbi,
          functionName: "create",
          args: [slug, init, configs, launchWeights],
          chain: robinhood,
        });
        hash = await walletClient.writeContract(request);
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Index creation reverted.");
      const launchedVault = await publicClient.readContract({
        address: atomicFactory || productionV2Factory,
        abi: atomicFactory ? atomicFactoryAbi : v2FactoryAbi,
        functionName: "bySlug",
        args: [slug],
      });
      await addVaultAssetToWallet({
        address: launchedVault,
        symbol,
        image: onChainImage || undefined,
      });
      router.push(`/i/${slug}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message.slice(0, 220) : "mint failed");
    } finally {
      setBusy(false);
    }
  }

  const selected = useMemo(() => {
    const catalog = [...INDEX_CATALOG, ...extra.filter((c) => !INDEX_CATALOG.some((x) => x.token === c.token))];
    return catalog.filter((c) => picked.includes(c.token));
  }, [picked, extra]);
  const catalog = useMemo(() => {
    const seen = new Set(INDEX_CATALOG.map((c) => c.token));
    return [...INDEX_CATALOG, ...extra.filter((c) => !seen.has(c.token))];
  }, [extra]);

  return (
    <section id="create" className="holo p-4 sm:p-6">
      <div>
        <p className="text-[13px] text-[var(--dim)]">Create</p>
        <h2 className="mt-1 text-[1.7rem] font-semibold leading-none tracking-[-0.04em] sm:text-3xl">
          Your index
        </h2>
        <p className="mt-3 max-w-xl text-[15px] leading-6 text-[var(--dim)]">
          Pick 2–24 names. Share /i/yourslug. You take {(feeBps / 100).toFixed(2)}% on each join;
          HOODX keeps {(PROTOCOL_FEE_BPS / 100).toFixed(2)}%. Only assets with approved routes can be used. Choose the launch allocation below; routes are checked
          before you sign.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Field
            label="Name"
            value={name}
            onChange={setName}
            placeholder="cats of hood"
            testId="forge-name"
          />
          <Field
            label="Ticker"
            value={symbol}
            onChange={(v) => {
              const s = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
              setSymbol(s);
              if (!touched) setSlug(toSlug(s));
            }}
            placeholder="CATSX"
            testId="forge-ticker"
          />
          <div>
            <Field
              label="Slug"
              value={slug}
              onChange={(v) => {
                setTouched(true);
                setSlug(toSlug(v));
              }}
              placeholder="catsx"
              testId="forge-slug"
            />
            <p className="mt-1 text-[12px] text-[var(--dim)]">
              /i/{slug || "…"} {slug && !slugOk ? " · reserved or invalid" : ""}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-[12px] text-[var(--dim)]">
            Your cut {(feeBps / 100).toFixed(2)}% · $100 join → {fmtUsd((100 * feeBps) / 10_000)} to you ·
            HOODX {(PROTOCOL_FEE_BPS / 100).toFixed(2)}%
          </p>
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={feeBps}
            onChange={(e) => setFeeBps(Number(e.target.value))}
            className="mt-2 w-full accent-[#1fd4c6]"
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <TokenArt slug={slug || "draft"} src={imageSrc || undefined} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-[var(--dim)]">Token image · optional</p>
            <p className="mt-1 text-[13px] leading-6 text-[var(--dim)]">
              Optional. HUD shows the upload. Paste an https URL so wallets and Blockscout pick it up at mint.
            </p>
            <label className="ghost mt-2 inline-flex cursor-pointer px-3 text-[13px] text-[var(--cyan)]">
              {imageSrc ? "Replace image" : "Upload image"}
              <input
                data-testid="forge-image"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void fileToTokenImage(file)
                    .then((data) => {
                      setImageSrc(data);
                      setErr(null);
                      if (slugOk) saveTokenImage(slug, data);
                    })
                    .catch((ex) => setErr(ex instanceof Error ? ex.message : "could not read image"));
                }}
              />
            </label>
            {imageSrc && (
              <button
                type="button"
                className="ml-2 text-[11px] text-[var(--dim)] underline-offset-4 hover:underline"
                onClick={() => setImageSrc("")}
              >
                Clear
              </button>
            )}
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value.trim())}
              placeholder="https://… wallet image URL (optional)"
              className="field mt-2 w-full text-xs"
            />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-[12px] text-[var(--dim)]">
            Optional payout wallet. Switch later without moving curation.
          </p>
          <input
            value={payout}
            onChange={(e) => setPayout(e.target.value.trim())}
            placeholder="0x… leave blank to pay yourself"
            className="field mt-1 text-xs"
          />
        </div>

        <div className="mt-5 text-[12px] text-[var(--dim)]">
          <span>
            {picked.length}/24 · {selected.map((s) => s.symbol).join(" · ") || "none yet"}
          </span>
        </div>

        {picked.length > 0 && (
          <div className="mt-5 rounded-xl border border-[var(--line)] p-4" data-testid="forge-allocation">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[12px] uppercase tracking-[0.14em] text-[var(--cyan)]">Launch allocation</p>
                <h3 className="mt-1 text-lg font-semibold">Set the portfolio before it goes on-chain.</h3>
              </div>
              <div className="flex gap-2">
                <button type="button" className="ghost px-3 py-2 text-[12px]" onClick={() => {
                  try {
                    setAllocationMode("equal");
                    const next = distribute(cash, picked.map(() => "1"), picked.map(() => false), true);
                    setWeights(Object.fromEntries(picked.map((token, i) => [token.toLowerCase(), next[i]])));
                  } catch (e) { setErr(e instanceof Error ? e.message : "Could not equalize allocation"); }
                }}>Equal weight</button>
                <button type="button" className="ghost px-3 py-2 text-[12px]" onClick={() => {
                  try {
                    const byToken = new Map(catalog.map((coin) => [coin.token.toLowerCase(), coin]));
                    const scores = picked.map((token) => Math.sqrt(Math.max(1, byToken.get(token.toLowerCase())?.mcapUsd || 0)));
                    const scoreTotal = scores.reduce((sum, score) => sum + score, 0);
                    const next = distribute(cash, scores.map((score) => ((score / scoreTotal) * 100).toFixed(2)), scores.map(() => false));
                    setAllocationMode("custom");
                    setWeights(Object.fromEntries(picked.map((token, i) => [token.toLowerCase(), next[i]])));
                  } catch (e) { setErr(e instanceof Error ? e.message : "Could not weight by market cap"); }
                }}>Mcap weight</button>
              </div>
            </div>
            <label className="mt-4 block text-[12px] text-[var(--dim)]">
              WETH reserve · {cash}%
              <input type="range" min={20} max={50} step={1} value={Number(cash) || 25} onChange={(e) => setCash(Number(e.target.value).toFixed(2))} className="mt-2 w-full accent-[#1fd4c6]" />
            </label>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {selected.map((coin) => (
                <label key={coin.token} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2 text-[13px]">
                  <span className="font-medium">{coin.symbol}</span>
                  <span className="flex items-center gap-1 text-[var(--dim)]">
                    <input aria-label={`${coin.symbol} weight`} value={weights[coin.token.toLowerCase()] || "0.00"} onChange={(e) => { setAllocationMode("custom"); setWeights((current) => ({ ...current, [coin.token.toLowerCase()]: e.target.value })); }} className="field w-24 text-right tabular" inputMode="decimal" />%
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <span className={allocation.total === 10_000 ? "text-[var(--mint)]" : "text-[var(--gold)]"}>
                Total {(allocation.total / 100).toFixed(2)}%{allocation.error ? ` · ${allocation.error}` : ""}
              </span>
              {allocation.total !== 10_000 && <button type="button" className="ghost px-3 py-2" onClick={() => {
                try {
                  const next = distribute(cash, picked.map((token) => weights[token.toLowerCase()] || "1"), picked.map(() => false));
                  setAllocationMode("custom");
                  setWeights(Object.fromEntries(picked.map((token, i) => [token.toLowerCase(), next[i]])));
                } catch (e) { setErr(e instanceof Error ? e.message : "Could not normalize allocation"); }
              }}>Normalize to 100%</button>}
            </div>
          </div>
        )}

        <AddName
          testId="forge-add"
          disabled={picked.length >= 24}
          onResolved={(coin) => {
            setExtra((p) => (p.some((x) => x.token === coin.token) ? p : [...p, coin]));
            setPicked((cur) => {
              if (cur.includes(coin.token) || cur.length >= 24) return cur;
              return [...cur, coin.token];
            });
          }}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {catalog.map((c) => {
            const on = picked.includes(c.token);
            return (
              <button
                key={c.token}
                type="button"
                data-testid={`pick-${c.symbol}`}
                data-symbol={c.symbol}
                data-on={on ? "1" : "0"}
                onClick={() => toggle(c.token)}
                className={`chip px-2.5 text-[12px] ${on ? "on" : "off"}`}
              >
                <span className="mr-1 text-[var(--gold)]">{tier(c.mcapUsd)}</span>
                {c.symbol}
                {(c.buyLabels || []).includes("v4") ? <span className="ml-1 text-[var(--dim)]">v4</span> : null}
                <span className={`ml-1 ${on ? "text-[var(--danger)]" : "text-[var(--lime)]"}`}>
                  {on ? "×" : "+"}
                </span>
              </button>
            );
          })}
        </div>

        {err && (
          <p data-testid="forge-err" className="mt-3 text-sm text-[var(--danger)]">
            {err}
          </p>
        )}
        {!live && (
          <p className="mt-3 text-xs text-[var(--dim)]">
            Factory offline. Save the draft — mint arms when the factory address is set.
          </p>
        )}

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            data-testid="forge-save"
            disabled={!ready}
            onClick={() => {
              persist();
              setErr(null);
              setSaved(true);
              window.setTimeout(() => setSaved(false), 1600);
            }}
            className="ghost py-3"
          >
            {saved ? "Saved" : "Save draft"}
          </button>
          <button
            type="button"
            data-testid="forge-mint"
            disabled={!ready || busy || (live && chainId !== robinhood.id)}
            onClick={() => {
              if (!address) {
                void connect();
                return;
              }
              void launch();
            }}
            className="ape py-3 text-sm disabled:opacity-40"
          >
            {!address ? (connecting ? "Connecting…" : "Connect to launch") : busy ? "Checking pools…" : "Launch index"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-[var(--dim)]">
        {label}
      </span>
      <input
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field mt-1 text-sm"
      />
    </label>
  );
}
