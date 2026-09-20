"use client";

import { useMemo, useState } from "react";
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
import { fileToTokenImage, saveTokenImage, walletImageUri } from "@/lib/tokenImage";
import { publicClient, useWallet } from "@/lib/wallet";

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
  const live = isAddress(productionV2Factory);
  const slugOk = okUserSlug(slug);
  const ready = picked.length >= 2 && name.trim().length >= 2 && symbol.length >= 2 && slugOk;

  function persist() {
    if (!slugOk) return;
    saveDraft({
      slug,
      name: name.trim() || symbol,
      symbol,
      tokens: picked,
      feeBps,
      payout: payout || undefined,
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
      const onChainImage = walletImageUri(imageUrl) || "";
      if (chainId !== robinhood.id) throw new Error("Switch your wallet to Robinhood Chain.");
      if (new TextEncoder().encode(onChainImage).length > 256) throw new Error("Use an HTTPS or IPFS image URL of at most 256 bytes.");
      const configAbi = parseAbi(["function configId(address) view returns (bytes32)"]);
      const configs = await Promise.all(tokens.map(async token => {
        for (const vault of Object.values(verifiedV2Vaults)) {
          const id = await publicClient.readContract({ address: vault, abi: configAbi, functionName: "configId", args: [token] });
          if (id !== `0x${"0".repeat(64)}`) return id;
        }
        throw new Error("A selected asset does not yet have an approved V2 route. Choose an asset from the official baskets.");
      }));
      const weights = tokens.map((_, i) => Math.floor(7500 / tokens.length) + (i < 7500 % tokens.length ? 1 : 0));
      const { request } = await publicClient.simulateContract({
        account: address,
        address: productionV2Factory,
        abi: v2FactoryAbi,
        functionName: "create",
        args: [slug, { curator: address, creator: address, recipient, treasury: productionV2Treasury, name: name.trim(), symbol, creatorFee: feeBps, protocolFee: 10, cashBps: 2500, firstDeposit: parseEther("0.02"), imageURI: onChainImage }, configs, weights],
        chain: robinhood,
      });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Index creation reverted.");
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
          HOODX keeps {(PROTOCOL_FEE_BPS / 100).toFixed(2)}%. Only assets with approved V2 routes can be used. The basket holds 25% cash, with the rest split equally. Routes are checked
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
