"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAddress, type Address } from "viem";
import { vaultAbi } from "@/lib/abi";
import { CATALOG, byAddress, tier, type Coin } from "@/lib/catalog";
import { robinhood } from "@/lib/chain";
import { CREATOR_FEE_BPS, PROTOCOL_FEE_BPS } from "@/lib/config";
import { CURATOR_696, CURATOR_696_PAYOUT, GEN0_SLUG, GEN0_SYMBOL } from "@/lib/curators";
import { shortAddr } from "@/lib/format";
import { defaultPack, loadPayout, loadTokens, savePayout, saveTokens } from "@/lib/packs";
import { publicClient, useWallet } from "@/lib/wallet";

const FLUSH_MS = 380;

function Glyph({ slug }: { slug: string }) {
  const cells = useMemo(() => {
    let h = 2166136261;
    for (const ch of slug) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return Array.from({ length: 16 }, (_, i) => ((h >>> i) & 1) === 1);
  }, [slug]);
  return (
    <span className="grid h-20 w-20 grid-cols-4 gap-px border border-[var(--line)] p-1">
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
  const [creatorBps, setCreatorBps] = useState(CREATOR_FEE_BPS);
  const [protocolBps, setProtocolBps] = useState(PROTOCOL_FEE_BPS);
  const [msg, setMsg] = useState("");
  const [feeBusy, setFeeBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [pop, setPop] = useState("");
  const live = Boolean(vault && isAddress(vault));
  const addQ = useRef<Set<string>>(new Set());
  const remQ = useRef<Set<string>>(new Set());
  const flushTimer = useRef(0);
  const flushing = useRef(false);
  const payoutInput = useRef<HTMLInputElement>(null);

  const reloadPack = useCallback(async () => {
    if (!live || !vault) return;
    const [own, creat, rec, list, cBps, pBps] = await Promise.all([
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
      publicClient.readContract({
        address: vault as Address,
        abi: vaultAbi,
        functionName: "creatorFeeBps",
      }),
      publicClient.readContract({
        address: vault as Address,
        abi: vaultAbi,
        functionName: "protocolFeeBps",
      }),
    ]);
    setOwner(own);
    setCreator(creat);
    setRecipient(rec);
    setCreatorBps(Number(cBps));
    setProtocolBps(Number(pBps));
    if (list?.length) setOn(list.map((a) => a.toLowerCase()));
  }, [live, vault]);

  useEffect(() => {
    setOn(loadTokens(slug, gen0 ? defaultPack() : []));
    setPayout(loadPayout(slug));
  }, [slug, gen0]);

  useEffect(() => {
    if (on.length) saveTokens(slug, on);
  }, [on, slug]);

  useEffect(() => {
    void reloadPack().catch(() => {});
  }, [reloadPack]);

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

  const flush = useCallback(async () => {
    if (!live || !vault || !walletClient || !address) return;
    if (flushing.current) return;
    const adds = [...addQ.current] as Address[];
    const rems = [...remQ.current] as Address[];
    addQ.current.clear();
    remQ.current.clear();
    setPending([]);
    if (!adds.length && !rems.length) return;
    flushing.current = true;
    setSyncing(true);
    try {
      if (adds.length === 1) {
        const hash = await walletClient.writeContract({
          account: address,
          address: vault as Address,
          abi: vaultAbi,
          functionName: "addToken",
          args: [adds[0]],
          chain: robinhood,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      } else if (adds.length > 1) {
        const hash = await walletClient.writeContract({
          account: address,
          address: vault as Address,
          abi: vaultAbi,
          functionName: "addTokens",
          args: [adds],
          chain: robinhood,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }
      if (rems.length === 1) {
        const hash = await walletClient.writeContract({
          account: address,
          address: vault as Address,
          abi: vaultAbi,
          functionName: "removeToken",
          args: [rems[0]],
          chain: robinhood,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      } else if (rems.length > 1) {
        const hash = await walletClient.writeContract({
          account: address,
          address: vault as Address,
          abi: vaultAbi,
          functionName: "removeTokens",
          args: [rems],
          chain: robinhood,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }
      const n = adds.length + rems.length;
      flash(n === 1 ? "pack synced" : `${n} names synced`);
    } catch (e) {
      flash(e instanceof Error ? e.message.slice(0, 160) : "sell to WETH first, then eject");
      await reloadPack().catch(() => {});
    } finally {
      flushing.current = false;
      setSyncing(false);
      if (addQ.current.size || remQ.current.size) {
        flushTimer.current = window.setTimeout(() => void flush(), FLUSH_MS);
      }
    }
  }, [live, vault, walletClient, address, reloadPack]);

  function scheduleFlush() {
    window.clearTimeout(flushTimer.current);
    const ids = [...addQ.current, ...remQ.current];
    setPending(ids);
    flushTimer.current = window.setTimeout(() => void flush(), FLUSH_MS);
  }

  function toggle(coin: Coin) {
    if (!canEdit) return;
    const has = on.includes(coin.token);
    if (has) {
      if (on.length <= 2) {
        flash("pack needs at least 2");
        return;
      }
      setOn((p) => p.filter((x) => x !== coin.token));
      flash(`− ${coin.symbol}`, coin.token);
      if (live && isOwner) {
        if (addQ.current.has(coin.token)) addQ.current.delete(coin.token);
        else remQ.current.add(coin.token);
        scheduleFlush();
      }
      return;
    }
    if (on.length >= 24) {
      flash("24 slot cap");
      return;
    }
    setOn((p) => [...p, coin.token]);
    flash(`+ ${coin.symbol}`, coin.token);
    if (live && isOwner) {
      if (remQ.current.has(coin.token)) remQ.current.delete(coin.token);
      else addQ.current.add(coin.token);
      scheduleFlush();
    }
  }

  async function setFeeAddr(who = payout) {
    if (!isAddress(who)) {
      flash("need a 0x address");
      payoutInput.current?.focus();
      return;
    }
    savePayout(slug, who);
    setPayout(who);
    if (!live || !vault || !walletClient || !address) {
      flash("payout saved — lands in the mint tx / Set when live");
      return;
    }
    if (!canPayout) {
      flash("only the creator can move the cut");
      return;
    }
    setFeeBusy(true);
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
      flash("payout rerouted — pack stays yours");
    } catch (e) {
      flash(e instanceof Error ? e.message.slice(0, 160) : "failed");
    } finally {
      setFeeBusy(false);
    }
  }

  function giveTo696() {
    if (CURATOR_696_PAYOUT && isAddress(CURATOR_696_PAYOUT)) {
      void setFeeAddr(CURATOR_696_PAYOUT);
      return;
    }
    flash("paste 696’s wallet, then Set — you keep curation");
    payoutInput.current?.focus();
  }

  const coinsOn = on.map((t) => byAddress(t)).filter(Boolean) as Coin[];
  const power = Math.round((on.length / 24) * 100);
  const title = gen0 ? `$${GEN0_SYMBOL}` : `$${slug.toUpperCase()}`;
  const pendingSet = new Set(pending);
  const payoutDirty =
    Boolean(payout) &&
    isAddress(payout) &&
    recipient &&
    payout.toLowerCase() !== recipient.toLowerCase();

  return (
    <article className="holo rounded-xl p-5 sm:p-7">
      <div className="flex flex-wrap items-start gap-5">
        {gen0 ? (
          <a href={CURATOR_696.x} target="_blank" rel="noreferrer" className="shrink-0">
            <span className="relative block h-20 w-20 overflow-hidden rounded-full border border-[var(--line)]">
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
          <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.2em] text-[var(--dim)]">
            {gen0 ? "First index · RH 4663" : "Index · RH 4663"}
          </p>
          <h2 className="font-[family-name:var(--font-display)] text-4xl tracking-wide sm:text-5xl">
            {title}
          </h2>
          {gen0 ? (
            <>
              <p className="mt-1 text-sm text-[var(--dim)]">
                Curated by{" "}
                <a className="text-[var(--paper)]" href={CURATOR_696.x} target="_blank" rel="noreferrer">
                  @{CURATOR_696.handle}
                </a>
                {CURATOR_696.followers ? ` · ${CURATOR_696.followers.toLocaleString()} on X` : ""}
              </p>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--paper)]/80">
                {CURATOR_696.blurb}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-[var(--dim)]">
              /i/{slug} · tap names to add or remove · reroute the creator cut anytime
            </p>
          )}
        </div>
        <div className="font-[family-name:var(--font-mono)] text-right text-[11px] text-[var(--dim)]">
          <div>
            {on.length}/24 names
          </div>
          <div className="mt-1 h-px w-24 bg-[var(--line)]">
            <div className="xp" style={{ width: `${power}%`, height: 1 }} />
          </div>
          <div className="mt-1">
            {creatorBps / 100}% creator / {protocolBps / 100}% HOODX
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--dim)]">
          <span>Names · tap to add or remove</span>
          <span className={canEdit ? "text-[var(--cyan)]" : "text-[var(--dim)]"}>
            {syncing
              ? "Syncing"
              : pending.length
                ? `${pending.length} queued`
                : canEdit
                  ? live
                    ? "Live"
                    : "Draft"
                  : "View only"}
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
            const wait = pendingSet.has(c.token);
            return (
              <button
                key={c.token}
                type="button"
                disabled={!canEdit}
                onClick={() => toggle(c)}
                className={`chip inline-flex items-center gap-2 rounded-sm px-2 py-1 font-[family-name:var(--font-mono)] text-xs ${
                  active ? "on" : "off"
                } ${pop === c.token ? "pop" : ""} ${wait ? "pending" : ""}`}
              >
                <span className="text-[var(--gold)]">{tier(c.mcapUsd)}</span>
                {c.symbol}
                {canEdit && (
                  <span className={active ? "text-[var(--danger)]" : "text-[var(--lime)]"}>
                    {wait ? "…" : active ? "×" : "+"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {coinsOn.length > 0 && (
          <p className="mt-3 font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-[var(--dim)]">
            {coinsOn.map((c) => c.symbol).join(" · ")}
          </p>
        )}
      </div>

      <div className="mt-6 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
        <div>
          <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--dim)]">
            Creator payout
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
            Every join pays {protocolBps / 100}% to HOODX + {creatorBps / 100}% to this address.
            Curation stays with you.
            {recipient ? ` Now: ${shortAddr(recipient)}` : ""}
            {payoutDirty ? " · saved address differs" : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              ref={payoutInput}
              value={payout}
              onChange={(e) => setPayout(e.target.value.trim())}
              placeholder="0x fee recipient"
              className="field min-w-[12rem] flex-1 text-xs"
              disabled={!canPayout}
            />
            <button
              type="button"
              disabled={feeBusy || !canPayout || (live && chainId !== robinhood.id)}
              onClick={() => void setFeeAddr()}
              className="rounded-sm border border-[var(--cyan)] px-3 py-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-[var(--cyan)] disabled:opacity-40"
            >
              Set
            </button>
            {gen0 && (
              <button
                type="button"
                disabled={feeBusy || !canPayout || (live && chainId !== robinhood.id)}
                onClick={giveTo696}
                className="rounded-sm border border-[var(--line)] px-3 py-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wider text-[var(--dim)] disabled:opacity-40"
              >
                Give to 696
              </button>
            )}
          </div>
        </div>
        {!compact && (
          <div className="flex flex-wrap items-end justify-end gap-2">
            <a href={`/i/${slug}`} className="ape rounded-sm px-5 py-3 text-sm">
              Open {title}
            </a>
            {gen0 && (
              <a
                href={CURATOR_696.tweet}
                target="_blank"
                rel="noreferrer"
                className="ghost rounded-sm px-4 py-3"
              >
                Watchlist
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
