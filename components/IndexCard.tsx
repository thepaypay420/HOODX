"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAddress, zeroAddress, type Address } from "viem";
import { AddName } from "@/components/AddName";
import { TokenArt } from "@/components/TokenArt";
import { erc20Abi, vaultAbi } from "@/lib/abi";
import { INDEX_CATALOG, byAddress, coinForBind, isIndexPool, poolRef, tier, type Coin } from "@/lib/catalog";
import { robinhood } from "@/lib/chain";
import { CREATOR_FEE_BPS, EXPLORER, PROTOCOL_FEE_BPS, WETH, isLive696x } from "@/lib/config";
import { CURATOR_696, CURATOR_696_CURATOR, CURATOR_696_PAYOUT, GEN0_SLUG, GEN0_SYMBOL } from "@/lib/curators";
import { ejectBlocked, isHeldWei, partitionRemovals, revertHint } from "@/lib/eject";
import { blockedHandoff, shortAddr, ZERO_ADDR } from "@/lib/format";
import { defaultPack, loadPayout, loadTokens, ownsDraft, savePayout, saveTokens } from "@/lib/packs";
import { ensureQuoteBridge } from "@/lib/quoteBridge";
import { canSetTokenImage, fileToTokenImage, saveTokenImage } from "@/lib/tokenImage";
import { publicClient, useWallet } from "@/lib/wallet";

const FLUSH_MS = 380;

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
  const [curatorAddr, setCuratorAddr] = useState("");
  const [owner, setOwner] = useState("");
  const [pendingOwner, setPendingOwner] = useState("");
  const [creator, setCreator] = useState("");
  const [recipient, setRecipient] = useState("");
  const [creatorBps, setCreatorBps] = useState(CREATOR_FEE_BPS);
  const [protocolBps, setProtocolBps] = useState(PROTOCOL_FEE_BPS);
  const [msg, setMsg] = useState("");
  const [feeBusy, setFeeBusy] = useState(false);
  const [bookBusy, setBookBusy] = useState(false);
  const [bookAck, setBookAck] = useState(false);
  const [fundAck, setFundAck] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [pop, setPop] = useState("");
  const [localDraft, setLocalDraft] = useState(false);
  const [artTick, setArtTick] = useState(0);
  const [extra, setExtra] = useState<Coin[]>([]);
  const [held, setHeld] = useState<string[]>([]);
  const live = Boolean(vault && isAddress(vault));
  const addQ = useRef<Set<string>>(new Set());
  const remQ = useRef<Set<string>>(new Set());
  const flushTimer = useRef(0);
  const flushing = useRef(false);
  const payoutInput = useRef<HTMLInputElement>(null);
  const curatorInput = useRef<HTMLInputElement>(null);

  const reloadPack = useCallback(async () => {
    if (!live || !vault) return;
    const [own, pending, creat, rec, list, cBps, pBps] = await Promise.all([
      publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "owner" }),
      publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "pendingOwner" }),
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
    setPendingOwner(pending && pending.toLowerCase() !== zeroAddress ? pending : "");
    setCreator(creat);
    setRecipient(rec);
    setCreatorBps(Number(cBps));
    setProtocolBps(Number(pBps));
    const addrs = (list as Address[]) || [];
    if (addrs.length) setOn(addrs.map((a) => a.toLowerCase()));
    const bags: string[] = [];
    if (addrs.length && vault) {
      const bals = await Promise.all(
        addrs.map((token) =>
          publicClient
            .readContract({
              address: token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [vault as Address],
            })
            .catch(() => 1n),
        ),
      );
      addrs.forEach((token, i) => {
        if (isHeldWei(bals[i])) bags.push(token.toLowerCase());
      });
    }
    setHeld(bags);
  }, [live, vault]);

  useEffect(() => {
    setLocalDraft(ownsDraft(slug));
  }, [slug]);

  useEffect(() => {
    if (live) return;
    const fallback = gen0 ? defaultPack() : [];
    if (localDraft) {
      setOn(loadTokens(slug, fallback));
      setPayout(loadPayout(slug));
      return;
    }
    setOn(fallback);
    setPayout("");
  }, [slug, gen0, live, localDraft]);

  const isOwner = Boolean(address && owner && address.toLowerCase() === owner.toLowerCase());
  const isCreator = Boolean(address && creator && address.toLowerCase() === creator.toLowerCase());
  const canEdit = live ? isOwner : localDraft;
  const canPayout = live ? isCreator : localDraft;
  const canHandBook = live ? isOwner : false;
  const pendingActive = Boolean(pendingOwner && pendingOwner.toLowerCase() !== ZERO_ADDR);
  const isPending = Boolean(
    address && pendingActive && address.toLowerCase() === pendingOwner.toLowerCase(),
  );

  useEffect(() => {
    if (!canEdit || !on.length) return;
    saveTokens(slug, on);
  }, [on, slug, canEdit]);

  useEffect(() => {
    void reloadPack().catch(() => {});
  }, [reloadPack]);

  const query = q.trim().toLowerCase();
  const catalog = useMemo(() => {
    const seen = new Set(INDEX_CATALOG.map((c) => c.token));
    return [...INDEX_CATALOG, ...extra.filter((c) => !seen.has(c.token))];
  }, [extra]);
  const visible = useMemo(() => {
    if (!query) return catalog;
    return catalog.filter(
      (c) =>
        c.symbol.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query) ||
        c.token.includes(query),
    );
  }, [query, catalog]);

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
        const coin = coinForBind(adds[0]);
        if (!coin || !isIndexPool(coin)) {
          throw new Error(
            "need a Uni V3 WETH, V4 ETH/WETH, or V4 RH-stock quote pool — paste the token 0x",
          );
        }
        await ensureQuoteBridge(vault as Address, coin, walletClient, address);
        const hash = await walletClient.writeContract({
          account: address,
          address: vault as Address,
          abi: vaultAbi,
          functionName: "addToken",
          args: [adds[0], poolRef(coin)],
          chain: robinhood,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      } else if (adds.length > 1) {
        const coins = adds.map((t) => {
          const coin = coinForBind(t);
          if (!coin || !isIndexPool(coin)) {
            throw new Error(
              "need a Uni V3 WETH, V4 ETH/WETH, or V4 RH-stock quote pool — paste the token 0x",
            );
          }
          return coin;
        });
        for (const coin of coins) {
          await ensureQuoteBridge(vault as Address, coin, walletClient, address);
        }
        const pools = coins.map((coin) => poolRef(coin));
        const hash = await walletClient.writeContract({
          account: address,
          address: vault as Address,
          abi: vaultAbi,
          functionName: "addTokens",
          args: [adds, pools],
          chain: robinhood,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }
      let empty: string[] = [];
      let blocked: string[] = [];
      if (rems.length) {
        const weiByToken = new Map<string, bigint>();
        for (const token of rems) {
          try {
            const bal = await publicClient.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [vault as Address],
            });
            weiByToken.set(token.toLowerCase(), bal);
          } catch {
            weiByToken.set(token.toLowerCase(), 1n);
          }
        }
        ({ empty, held: blocked } = partitionRemovals(rems, weiByToken));
        if (blocked.length) {
          setHeld((p) => [...new Set([...p, ...blocked.map((t) => t.toLowerCase())])]);
        }
        if (empty.length === 1) {
          const hash = await walletClient.writeContract({
            account: address,
            address: vault as Address,
            abi: vaultAbi,
            functionName: "removeToken",
            args: [empty[0] as Address],
            chain: robinhood,
          });
          await publicClient.waitForTransactionReceipt({ hash });
        } else if (empty.length > 1) {
          const hash = await walletClient.writeContract({
            account: address,
            address: vault as Address,
            abi: vaultAbi,
            functionName: "removeTokens",
            args: [empty as Address[]],
            chain: robinhood,
          });
          await publicClient.waitForTransactionReceipt({ hash });
        } else if (!adds.length) {
          const names = blocked.map((t) => byAddress(t)?.symbol || shortAddr(t)).join(", ");
          flash(ejectBlocked(names, true) || "sell to WETH first, then eject");
          await reloadPack().catch(() => {});
          return;
        }
      }
      const n = adds.length + empty.length;
      const synced = n === 1 ? "pack synced" : `${n} names synced`;
      if (blocked.length) {
        const names = blocked.map((t) => byAddress(t)?.symbol || shortAddr(t)).join(", ");
        flash(`${synced} · ${ejectBlocked(names, true)}`);
      } else {
        flash(synced);
      }
    } catch (e) {
      flash(revertHint(e));
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

  async function toggle(coin: Coin) {
    if (!canEdit) return;
    const token = coin.token.toLowerCase();
    const has = on.includes(token);
    if (has) {
      if (on.length <= 2) {
        flash("pack needs at least 2");
        return;
      }
      if (live && isOwner && vault) {
        let bag = held.includes(token);
        try {
          const bal = await publicClient.readContract({
            address: coin.token as Address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [vault as Address],
          });
          bag = isHeldWei(bal);
        } catch {
          flash("could not read vault bag — try again");
          return;
        }
        if (bag) {
          setHeld((p) => (p.includes(token) ? p : [...p, token]));
          flash(ejectBlocked(coin.symbol, true) || "");
          return;
        }
        setHeld((p) => p.filter((t) => t !== token));
      }
      setOn((p) => p.filter((x) => x !== token));
      flash(`− ${coin.symbol}`, token);
      if (live && isOwner) {
        if (addQ.current.has(token)) addQ.current.delete(token);
        else remQ.current.add(token);
        scheduleFlush();
      }
      return;
    }
    if (on.length >= 24) {
      flash("24 slot cap");
      return;
    }
    if (!isIndexPool(coin)) {
      flash("Uni V3 WETH or V4 ETH/WETH pool required");
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
      flash("payout rerouted — pack stays yours until you hand the book");
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
    flash("paste 696’s wallet, then Set — fees only, you keep the book");
    payoutInput.current?.focus();
  }

  async function nominateCurator(who = curatorAddr) {
    const blocked = blockedHandoff(who, { owner, vault, weth: WETH });
    if (blocked) {
      flash(blocked);
      curatorInput.current?.focus();
      return;
    }
    if (!bookAck) {
      flash("check the box — they get add/remove, you keep the cut");
      return;
    }
    if (isLive696x(vault) && !fundAck) {
      flash("696X is live — check that you hold this key so users can still redeem");
      return;
    }
    if (!live || !vault || !walletClient || !address) {
      flash("connect the curator wallet on a live vault");
      return;
    }
    if (!canHandBook) {
      flash("only the current curator can nominate");
      return;
    }
    setBookBusy(true);
    try {
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "transferOwnership",
        args: [who as Address],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setPendingOwner(who);
      setBookAck(false);
      setFundAck(false);
      flash(`nominated ${who} — they must Accept from that wallet`);
    } catch (e) {
      flash(e instanceof Error ? e.message.slice(0, 160) : "failed");
    } finally {
      setBookBusy(false);
    }
  }

  function handBookTo696() {
    if (CURATOR_696_CURATOR && isAddress(CURATOR_696_CURATOR)) {
      setCuratorAddr(CURATOR_696_CURATOR);
      flash(`confirm ${CURATOR_696_CURATOR} — check the box, then Nominate`);
      curatorInput.current?.focus();
      return;
    }
    flash("paste 696’s wallet, check the box, then Nominate — they must Accept");
    curatorInput.current?.focus();
  }

  async function acceptBook() {
    if (!live || !vault || !walletClient || !address) return;
    if (!isPending) {
      flash("this wallet is not nominated");
      return;
    }
    setBookBusy(true);
    try {
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "acceptOwnership",
        args: [],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setOwner(address);
      setPendingOwner("");
      flash("you have the book — creator still holds the cut");
    } catch (e) {
      flash(e instanceof Error ? e.message.slice(0, 160) : "failed");
    } finally {
      setBookBusy(false);
    }
  }

  async function cancelBook() {
    if (!live || !vault || !walletClient || !address) return;
    if (!canHandBook) return;
    setBookBusy(true);
    try {
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "cancelOwnershipTransfer",
        args: [],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setPendingOwner("");
      flash("nomination canceled");
    } catch (e) {
      flash(e instanceof Error ? e.message.slice(0, 160) : "failed");
    } finally {
      setBookBusy(false);
    }
  }

  const coinsOn = on.map((t) => byAddress(t)).filter(Boolean) as Coin[];
  const title = gen0 ? `$${GEN0_SYMBOL}` : `$${slug.toUpperCase()}`;
  const pendingSet = new Set(pending);
  const heldSet = useMemo(() => new Set(held.map((t) => t.toLowerCase())), [held]);
  const payoutDirty =
    Boolean(payout) &&
    isAddress(payout) &&
    recipient &&
    payout.toLowerCase() !== recipient.toLowerCase();

  return (
    <article data-testid="index-card" className="holo overflow-hidden p-4 sm:p-6">
      <div className="flex items-center gap-3.5 sm:gap-5">
        {gen0 ? (
          <a href={CURATOR_696.x} target="_blank" rel="noreferrer" className="shrink-0">
            <TokenArt slug={slug} size="md" priority />
          </a>
        ) : (
          <span className="relative shrink-0">
            <TokenArt key={artTick} slug={slug} size="md" />
            {canEdit && canSetTokenImage(slug) && (
              <label className="absolute inset-0 cursor-pointer rounded-full">
                <span className="sr-only">Upload token image</span>
                <input
                  data-testid="pack-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void fileToTokenImage(file)
                      .then((data) => {
                        saveTokenImage(slug, data);
                        setArtTick((n) => n + 1);
                        flash("token image saved on HOODX");
                      })
                      .catch((err) => flash(err instanceof Error ? err.message : "could not read image"));
                  }}
                />
              </label>
            )}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-none text-[var(--dim)]">
            {gen0 ? "First index" : `/i/${slug}`}
          </p>
          <h2 className="mt-1 truncate text-[1.65rem] font-semibold leading-none tracking-[-0.04em] sm:text-4xl">
            {title}
          </h2>
          {live && vault && (
            <a
              data-testid="pack-vault-link"
              href={`${EXPLORER}/address/${vault}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block font-[family-name:var(--font-mono)] text-[11px] text-[var(--gold)] underline-offset-4 hover:underline"
            >
              Vault {shortAddr(vault)} · tokens
            </a>
          )}
        </div>
      </div>

      {gen0 ? (
        <p className="mt-3 text-[13px] text-[var(--dim)]">
          Curated by{" "}
          <a className="text-[var(--paper)]" href={CURATOR_696.x} target="_blank" rel="noreferrer">
            @{CURATOR_696.handle}
          </a>
        </p>
      ) : (
        canEdit && (
          <p className="mt-4 text-[15px] leading-6 text-[var(--dim)]">
            Tap names to add or remove.
            {canSetTokenImage(slug)
              ? " Tap the glyph to set a token image — shown on HOODX now; wallets wait on a later factory."
              : ""}
          </p>
        )
      )}

      <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-[var(--line)] pt-4">
        <div>
          <dt className="text-[11px] text-[var(--dim)]">Names</dt>
          <dd className="mt-0.5 tabular text-sm text-[var(--paper)]">
            {on.length}/24
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-[var(--dim)]">Creator</dt>
          <dd className="mt-0.5 tabular text-sm text-[var(--paper)]">{creatorBps / 100}%</dd>
        </div>
        <div>
          <dt className="text-[11px] text-[var(--dim)]">HOODX</dt>
          <dd className="mt-0.5 tabular text-sm text-[var(--paper)]">{protocolBps / 100}%</dd>
        </div>
      </dl>

      <div className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--dim)]">
          <span>
            {canEdit
              ? live
                ? "On the book · + adds, × drops an empty name. A bag must be sold to WETH on Rebalance first."
                : "On the book · tap + to add from this list, × to drop"
              : "Names"}
          </span>
          {canEdit && (
            <span data-testid="pack-status" className="text-[var(--cyan)]">
              {syncing ? "Syncing" : pending.length ? `${pending.length} queued` : live ? "Live" : "Draft"}
            </span>
          )}
        </div>
        {canEdit && (
          <AddName
            testId="pack-add"
            disabled={on.length >= 24 || (live && chainId !== robinhood.id)}
            onResolved={async (coin) => {
              setExtra((p) => (p.some((x) => x.token === coin.token) ? p : [...p, coin]));
              if (on.includes(coin.token)) {
                flash(`${coin.symbol} is already on the book`);
                return;
              }
              await toggle(coin);
            }}
          />
        )}
        {live && !canEdit && (
          <p className="mb-3 text-[13px] leading-5 text-[var(--dim)]">
            Connect the curator wallet to add a token that is not on this list.
          </p>
        )}
        {canEdit && (
          <input
            data-testid="pack-filter"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter this list"
            className="field mb-3 text-sm"
          />
        )}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            {visible.map((c) => {
              const active = on.includes(c.token);
              const wait = pendingSet.has(c.token);
              const bag = active && heldSet.has(c.token);
              return (
                <button
                  key={c.token}
                  type="button"
                  data-testid={`pack-chip-${c.symbol}`}
                  data-symbol={c.symbol}
                  data-on={active ? "1" : "0"}
                  data-held={bag ? "1" : "0"}
                  title={bag ? `${c.symbol} still in the vault — sell to WETH on Rebalance, then tap ×` : undefined}
                  onClick={() => void toggle(c)}
                  className={`chip inline-flex items-center gap-2 px-2.5 text-[12px] ${
                    active ? "on" : "off"
                  } ${pop === c.token ? "pop" : ""} ${wait ? "pending" : ""} ${bag ? "held" : ""}`}
                >
                  <span className="text-[var(--gold)]">{tier(c.mcapUsd)}</span>
                  {c.symbol}
                  {(c.buyLabels || []).includes("v4") ? <span className="text-[var(--dim)]">v4</span> : null}
                  <span className={bag ? "text-[var(--gold)]" : active ? "text-[var(--danger)]" : "text-[var(--lime)]"}>
                    {wait ? "…" : bag ? "bag" : active ? "×" : "+"}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {coinsOn.map((c) => (
              <span
                key={c.token}
                className="chip on inline-flex items-center gap-2 px-2.5 text-[12px]"
              >
                <span className="text-[var(--gold)]">{tier(c.mcapUsd)}</span>
                {c.symbol}
              </span>
            ))}
          </div>
        )}
      </div>

      {(canPayout || canHandBook || isPending || pendingActive || !compact) && (
      <div className="mt-6 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
        {canPayout && (
        <div>
          <p className="text-[12px] text-[var(--dim)]">
            Creator payout
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
            Every join pays {protocolBps / 100}% to HOODX + {creatorBps / 100}% to this address.
            Fees only — pack stays yours until you nominate a curator.
            {recipient ? ` Now: ${shortAddr(recipient)}` : ""}
            {payoutDirty ? " · saved address differs" : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              ref={payoutInput}
              data-testid="payout-addr"
              value={payout}
              onChange={(e) => setPayout(e.target.value.trim())}
              placeholder="0x fee recipient"
              className="field min-w-[12rem] flex-1 text-xs"
            />
            <button
              type="button"
              data-testid="payout-set"
              disabled={feeBusy || (live && chainId !== robinhood.id)}
              onClick={() => void setFeeAddr()}
              className="ghost h-10 px-3 text-[13px] disabled:opacity-40"
            >
              Set
            </button>
            {gen0 && (
              <button
                type="button"
                data-testid="payout-696"
                disabled={feeBusy || (live && chainId !== robinhood.id)}
                onClick={giveTo696}
                className="ghost h-10 px-3 text-[13px] text-[var(--dim)] disabled:opacity-40"
              >
                Give to 696
              </button>
            )}
          </div>
        </div>
        )}
        {(canHandBook || isPending || pendingActive) && (
        <div>
          <p className="text-[12px] text-[var(--dim)]">
            Curation
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
            Owner adds, removes, and rebalances. Two-step: nominate, then they Accept from that
            wallet. They cannot move or zero the creator cut.
            {isLive696x(vault)
              ? " Live 696X has user funds — nominate only a wallet whose key you hold. A dead key bricks rebalance (redeem still works)."
              : ""}
            {owner ? ` Now: ${shortAddr(owner)}` : ""}
          </p>
          {pendingActive && (
            <p
              data-testid="curator-pending"
              className="mt-2 break-all font-[family-name:var(--font-mono)] text-[11px] text-[var(--gold)]"
            >
              Waiting on {pendingOwner} to Accept
            </p>
          )}
          {canHandBook && (
            <>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  ref={curatorInput}
                  data-testid="curator-addr"
                  value={curatorAddr}
                  onChange={(e) => setCuratorAddr(e.target.value.trim())}
                  placeholder="0x curator (must Accept)"
                  className="field min-w-[12rem] flex-1 text-xs"
                />
                <button
                  type="button"
                  data-testid="curator-nominate"
                  disabled={bookBusy || (live && chainId !== robinhood.id)}
                  onClick={() => void nominateCurator()}
                  className="ghost h-10 px-3 text-[13px] disabled:opacity-40"
                >
                  Nominate
                </button>
                {gen0 && (
                  <button
                    type="button"
                    data-testid="curator-696"
                    disabled={bookBusy || (live && chainId !== robinhood.id)}
                    onClick={handBookTo696}
                    className="ghost h-10 px-3 text-[13px] text-[var(--dim)] disabled:opacity-40"
                  >
                    Hand book to 696
                  </button>
                )}
                {pendingActive && (
                  <button
                    type="button"
                    data-testid="curator-cancel"
                    disabled={bookBusy || (live && chainId !== robinhood.id)}
                    onClick={() => void cancelBook()}
                    className="ghost h-10 px-3 text-[13px] text-[var(--danger)] disabled:opacity-40"
                  >
                    Cancel
                  </button>
                )}
              </div>
              <label className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-[var(--dim)]">
                <input
                  data-testid="curator-ack"
                  type="checkbox"
                  checked={bookAck}
                  onChange={(e) => setBookAck(e.target.checked)}
                  className="mt-0.5"
                />
                They get add/remove/rebalance. I keep the {creatorBps / 100}% cut.
              </label>
              {isLive696x(vault) && (
                <label className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-[var(--gold)]">
                  <input
                    data-testid="curator-fund-ack"
                    type="checkbox"
                    checked={fundAck}
                    onChange={(e) => setFundAck(e.target.checked)}
                    className="mt-0.5"
                  />
                  I hold this key. Users keep redeem. Do not hand the book to a wallet nobody can sign.
                </label>
              )}
            </>
          )}
          {isPending && (
            <button
              type="button"
              data-testid="curator-accept"
              disabled={bookBusy || chainId !== robinhood.id}
              onClick={() => void acceptBook()}
              className="ape mt-3 px-4 text-[13px]"
            >
              Accept curation
            </button>
          )}
        </div>
        )}
        {!compact && (
          <div className="flex flex-wrap items-end justify-end gap-2">
            <a href={`/i/${slug}`} className="ape px-5 text-sm">
              Open {title}
            </a>
            {gen0 && (
              <a
                href={CURATOR_696.tweet}
                target="_blank"
                rel="noreferrer"
                className="ghost px-4"
              >
                Watchlist
              </a>
            )}
          </div>
        )}
      </div>
      )}
      {msg && (
        <p
          data-testid="pack-msg"
          className="toast relative z-10 mt-3 font-[family-name:var(--font-mono)] text-xs text-[var(--gold)]"
        >
          {msg}
        </p>
      )}
    </article>
  );
}
