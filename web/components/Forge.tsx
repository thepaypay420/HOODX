"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type Address } from "viem";
import { factoryAbi } from "@/lib/abi";
import { CATALOG, tier } from "@/lib/catalog";
import { robinhood } from "@/lib/chain";
import { CREATOR_FEE_BPS, FACTORY, PROTOCOL_FEE_BPS } from "@/lib/config";
import { fmtUsd, isAddress, okUserSlug, toSlug } from "@/lib/format";
import { saveDraft, savePayout } from "@/lib/packs";
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
  const live = isAddress(FACTORY);
  const power = Math.round((picked.length / 24) * 100);
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
      const tokens = picked as Address[];
      const hash = await walletClient.writeContract({
        account: address,
        address: FACTORY as Address,
        abi: factoryAbi,
        functionName: "create",
        args: [name.trim(), symbol, slug, tokens, feeBps],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      router.push(`/i/${slug}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message.slice(0, 220) : "forge failed");
    } finally {
      setBusy(false);
    }
  }

  const selected = useMemo(() => CATALOG.filter((c) => picked.includes(c.token)), [picked]);

  return (
    <section id="forge" className="holo rounded-2xl p-5 sm:p-6">
      <div className="relative z-10">
        <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.28em] text-[var(--mag)]">
          FORGE · USER INDEX
        </p>
        <h2 className="mt-1 font-[family-name:var(--font-hud)] text-3xl tracking-[0.08em] sm:text-4xl">
          BUILD YOUR PACK
        </h2>
        <p className="mt-2 max-w-xl text-sm text-[var(--dim)]">
          Lock 2–24 RH names. Drop /i/yourslug. Friends ape, you take {(feeBps / 100).toFixed(2)}%,
          protocol {(PROTOCOL_FEE_BPS / 100).toFixed(2)}%. Reroute your cut anytime — even to 696.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Field label="Callsign" value={name} onChange={setName} placeholder="cats of hood" />
          <Field
            label="Ticker"
            value={symbol}
            onChange={(v) => {
              const s = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
              setSymbol(s);
              if (!touched) setSlug(toSlug(s));
            }}
            placeholder="CATSX"
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
            />
            <p className="mt-1 font-[family-name:var(--font-mono)] text-[10px] text-[var(--dim)]">
              /i/{slug || "…"} {slug && !slugOk ? " · reserved or invalid" : ""}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-[var(--dim)]">
            Your cut {feeBps} bps · $100 ape → {fmtUsd((100 * feeBps) / 10_000)} to you · proto always{" "}
            {PROTOCOL_FEE_BPS} bps
          </p>
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={feeBps}
            onChange={(e) => setFeeBps(Number(e.target.value))}
            className="mt-2 w-full accent-[#5ef2ff]"
          />
        </div>

        <div className="mt-4">
          <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-[var(--dim)]">
            Optional payout address (else your wallet — switch later)
          </p>
          <input
            value={payout}
            onChange={(e) => setPayout(e.target.value.trim())}
            placeholder="0x… leave blank to pay yourself"
            className="field mt-1 text-xs"
          />
        </div>

        <div className="mt-5 flex items-center justify-between font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-[var(--dim)]">
          <span>
            Deck {picked.length}/24 · {selected.map((s) => s.symbol).join(" · ") || "empty"}
          </span>
          <span className="text-[var(--cyan)]">POWER {power}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-[var(--mag)]" style={{ width: `${power}%` }} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {CATALOG.map((c) => {
            const on = picked.includes(c.token);
            return (
              <button
                key={c.token}
                type="button"
                onClick={() => toggle(c.token)}
                className={`chip rounded-sm px-2 py-1 font-[family-name:var(--font-mono)] text-xs ${on ? "on" : "off"}`}
              >
                <span className="mr-1 text-[var(--gold)]">{tier(c.mcapUsd)}</span>
                {c.symbol}
                <span className={`ml-1 ${on ? "text-[var(--danger)]" : "text-[var(--lime)]"}`}>
                  {on ? "×" : "+"}
                </span>
              </button>
            );
          })}
        </div>

        {err && <p className="mt-3 text-sm text-[var(--danger)]">{err}</p>}
        {!live && (
          <p className="mt-3 text-xs text-[var(--dim)]">
            Factory offline. Save the deck anyway — mint arms when NEXT_PUBLIC_FACTORY_ADDRESS is set.
          </p>
        )}

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              persist();
              setErr(null);
              setSaved(true);
              window.setTimeout(() => setSaved(false), 1600);
            }}
            className="ghost rounded-sm py-3"
          >
            {saved ? "Draft locked" : "Save draft"}
          </button>
          <button
            type="button"
            disabled={!ready || busy || (live && chainId !== robinhood.id)}
            onClick={() => {
              if (!address) {
                void connect();
                return;
              }
              void launch();
            }}
            className="ape rounded-sm py-3 text-sm disabled:opacity-40"
          >
            {!address ? (connecting ? "Linking…" : "Jack in to forge") : busy ? "Confirm…" : "Mint this index"}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-[var(--dim)]">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field mt-1 text-sm"
      />
    </label>
  );
}
