"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { vaultAbi } from "@/lib/abi";
import { CATALOG, byAddress, tier, type Coin } from "@/lib/catalog";
import { robinhood } from "@/lib/chain";
import { CREATOR_FEE_BPS, PROTOCOL_FEE_BPS } from "@/lib/config";
import { CURATOR_696, GEN0_SLUG, GEN0_SYMBOL } from "@/lib/curators";
import { shortAddr } from "@/lib/format";
import { defaultPack, loadPayout, loadTokens, savePayout, saveTokens } from "@/lib/packs";
import { publicClient, useWallet } from "@/lib/wallet";

function Glyph({ slug }: { slug: string }) {
  const cells = useMemo(() => {
    let h = 2166136261;
    for (const ch of slug) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return Array.from({ length: 16 }, (_, i) => ((h >>> i) & 1) === 1);
  }, [slug]);
  return (
    <span className="grid h-24 w-24 grid-cols-4 gap-0.5 border border-[var(--mag)] p-1 shadow-[0_0_24px_rgba(255,43,214,0.28)]">
      {cells.map((on, i) => (
        <span key={i} className={on ? "bg-[var(--mag)]" : "bg-white/5"} />
      ))}
    </span>
  );
}

export function IndexCard({
  slug = GEN0_SLUG,
  vault,
  compact = false,
}: {
  slug?: string;
  vault?: string;
  compact?: boolean;
}) {
  const gen0 = slug === GEN0_SLUG;
  const { address, chainId, walletClient } = useWallet();
  const [on, setOn] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [payout, setPayout] = useState("");
  const [owner, setOwner] = useState("");
  const [creator, setCreator] = useState("");
  const [recipient, setRecipient] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [pop, setPop] = useState<string>("");
  const live = Boolean(vault && isAddress(vault));

  useEffect(() => {
    setOn(loadTokens(slug, gen0 ? defaultPack() : []));
    setPayout(loadPayout(slug));
  }, [slug, gen0]);

  useEffect(() => {
    if (on.length) saveTokens(slug, on);
  }, [on, slug]);

  useEffect(() => {
    if (!live || !vault) return;
    Promise.all([
      publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "owner" }),
      publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "creator" }),
      publicClient.readContract({
        address: vault as Address,
        abi: vaultAbi,
        functionName: "creatorRecipient",
      }),
      publicClient.readContract({
        address: vault as Address,
        abi: vaultAbi,
        functionName: "constituents",
      }),
    ])
      .then(([own, creat, rec, list]) => {
        setOwner(own);
        setCreator(creat);
        setRecipient(rec);
        if (list?.length) setOn(list.map((a) => a.toLowerCase()));
      })
      .catch(() => {});
  }, [live, vault]);

  const isOwner = Boolean(address && owner && address.toLowerCase() === owner.toLowerCase());
  const isCreator = Boolean(address && creator && address.toLowerCase() === creator.toLowerCase());
  const canEdit = !live || isOwner;
  const canPayout = !live || isCreator || isOwner;
  const query = q.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!query) return CATALOG;
    return CATALOG.filter(
      (c) =>
        c.symbol.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query) ||
        c.token.includes(query),
    );
  }, [query]);

  function flash(text: string, token?: string) {
    setMsg(text);
    if (token) {
      setPop(token);
      window.setTimeout(() => setPop(""), 280);
    }
  }

  async function chainAdd(token: string) {
    if (!live || !vault || !walletClient || !address) return;
    setBusy(true);
    try {
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "addToken",
        args: [token as Address],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      flash("coin locked in", token);
    } catch (e) {
      setOn((p) => p.filter((x) => x !== token));
      flash(e instanceof Error ? e.message.slice(0, 160) : "add failed");
    } finally {
      setBusy(false);
    }
  }

  async function chainRemove(token: string) {
    if (!live || !vault || !walletClient || !address) return;
    setBusy(true);
    try {
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "removeToken",
        args: [token as Address],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      flash("coin ejected", token);
    } catch (e) {
      setOn((p) => [...p, token]);
      flash(e instanceof Error ? e.message.slice(0, 160) : "sell to WETH first, then eject");
    } finally {
      setBusy(false);
    }
  }

  function toggle(coin: Coin) {
    if (!canEdit || busy) return;
    const has = on.includes(coin.token);
    if (has) {
      if (on.length <= 2) {
        flash("pack needs at least 2");
        return;
      }
      setOn((p) => p.filter((x) => x !== coin.token));
      flash(`− ${coin.symbol} ejected`, coin.token);
      if (live && isOwner) void chainRemove(coin.token);
      return;
    }
    if (on.length >= 24) {
      flash("24 slot cap");
      return;
    }
    setOn((p) => [...p, coin.token]);
    flash(`+ ${coin.symbol} locked`, coin.token);
    if (live && isOwner) void chainAdd(coin.token);
  }

  async function setFeeAddr(who = payout) {
    if (!isAddress(who)) {
      flash("need a 0x address");
      return;
    }
    savePayout(slug, who);
    if (!live || !vault || !walletClient || !address) {
      flash("payout saved — applies when the vault is live");
      return;
    }
    if (!canPayout) {
      flash("only creator or curator");
      return;
    }
    setBusy(true);
    try {
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "setCreatorRecipient",
        args: [who as Address],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setRecipient(who);
      flash("payout rerouted");
    } catch (e) {
      flash(e instanceof Error ? e.message.slice(0, 160) : "failed");
    } finally {
      setBusy(false);
    }
  }

  const coinsOn = on.map((t) => byAddress(t)).filter(Boolean) as Coin[];
  const power = Math.round((on.length / 24) * 100);
  const title = gen0 ? `$${GEN0_SYMBOL}` : `$${slug.toUpperCase()}`;

  return (
    <article className="holo rounded-2xl p-5 sm:p-6">
      <div className="relative z-10 flex flex-wrap items-start gap-5">
        {gen0 ? (
          <a href={CURATOR_696.x} target="_blank" rel="noreferrer" className="shrink-0">
            <span className="relative block h-24 w-24 overflow-hidden rounded-sm border border-[var(--cyan)] shadow-[0_0_24px_rgba(94,242,255,0.35)]">
              <Image
                src={CURATOR_696.avatar}
                alt={`@${CURATOR_696.handle}`}
                width={400}
                height={400}
                priority
                className="h-full w-full object-cover"
              />
            </span>
          </a>
        ) : (
          <Glyph slug={slug} />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.28em] text-[var(--cyan)]">
            {gen0 ? "GEN-0 · LEGENDARY · RH 4663" : "USER INDEX · RH 4663"}
          </p>
          <h2 className="font-[family-name:var(--font-hud)] text-4xl tracking-[0.12em] sm:text-5xl">
            {title}
          </h2>
          {gen0 ? (
            <>
              <p className="mt-1 text-sm text-[var(--dim)]">
                Curated by{" "}
                <a className="text-[var(--cyan)]" href={CURATOR_696.x} target="_blank" rel="noreferrer">
                  @{CURATOR_696.handle}
                </a>{" "}
                · {CURATOR_696.followers.toLocaleString()} on X · whole pack, one bag
              </p>
              <p className="mt-2 max-w-xl text-sm text-[#c5e8f4]">{CURATOR_696.blurb}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-[var(--dim)]">
              /i/{slug} · tap chips to lock or eject · reroute the creator cut anytime
            </p>
          )}
        </div>
        <div className="font-[family-name:var(--font-mono)] text-right text-[11px] text-[var(--dim)]">
          <div>
            PACK POWER <span className="text-[var(--cyan)] tabular">{power}%</span>
          </div>
          <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
            <div className="xp" style={{ width: `${power}%` }} />
          </div>
          <div className="mt-1">
            {on.length}/24 SLOTS · {CREATOR_FEE_BPS / 100}% curator / {PROTOCOL_FEE_BPS / 100}% proto
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-[var(--dim)]">
          <span>Assets · tap to add/remove · live edit is instant</span>
          <span className={canEdit ? "text-[var(--cyan)]" : "text-[var(--dim)]"}>
            {canEdit ? (live ? "CURATOR LIVE" : "DRAFT") : "VIEW ONLY"}
          </span>
        </div>
        {canEdit && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter — symbol or 0x"
            className="field mb-3 text-sm"
          />
        )}
        <div className="flex flex-wrap gap-2">
          {visible.map((c) => {
            const active = on.includes(c.token);
            return (
              <button
                key={c.token}
                type="button"
                disabled={!canEdit || busy}
                onClick={() => toggle(c)}
                className={`chip inline-flex items-center gap-2 rounded-sm px-2 py-1 font-[family-name:var(--font-mono)] text-xs ${
                  active ? "on" : "off"
                } ${pop === c.token ? "pop" : ""}`}
              >
                <span className="text-[var(--gold)]">{tier(c.mcapUsd)}</span>
                {c.symbol}
                {canEdit && <span className={active ? "text-[var(--danger)]" : "text-[var(--lime)]"}>{active ? "×" : "+"}</span>}
              </button>
            );
          })}
        </div>
        {coinsOn.length > 0 && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-[var(--dim)]">
            LIVE LINEUP · {coinsOn.map((c) => c.symbol).join(" · ")}
          </p>
        )}
      </div>

      <div className="relative z-10 mt-6 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
        <div>
          <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-[var(--dim)]">
            Creator payout — switch without handing over the pack
          </p>
          <p className="mt-1 text-xs text-[var(--dim)]">
            Platform always takes {PROTOCOL_FEE_BPS / 100}%. Your {CREATOR_FEE_BPS / 100}% can point at
            696 later.
            {recipient ? ` On-chain: ${shortAddr(recipient)}` : ""}
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={payout}
              onChange={(e) => setPayout(e.target.value.trim())}
              placeholder="0x fee recipient"
              className="field flex-1 text-xs"
              disabled={!canPayout}
            />
            <button
              type="button"
              disabled={busy || !canPayout || (live && chainId !== robinhood.id)}
              onClick={() => void setFeeAddr()}
              className="rounded-sm border border-[var(--cyan)] px-3 py-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-[var(--cyan)] disabled:opacity-40"
            >
              Set
            </button>
          </div>
        </div>
        {!compact && (
          <div className="flex flex-wrap items-end justify-end gap-2">
            <a href={`/i/${slug}`} className="ape rounded-sm px-5 py-3 text-sm">
              Ape {title}
            </a>
            {gen0 && (
              <a
                href={CURATOR_696.tweet}
                target="_blank"
                rel="noreferrer"
                className="ghost rounded-sm px-4 py-3"
              >
                Source tape
              </a>
            )}
          </div>
        )}
      </div>
      {msg && (
        <p className="toast relative z-10 mt-3 font-[family-name:var(--font-mono)] text-xs text-[var(--gold)]">
          {msg}
        </p>
      )}
    </article>
  );
}
