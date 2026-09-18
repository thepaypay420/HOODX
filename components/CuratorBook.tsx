"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, type Address } from "viem";
import { erc20Abi, vaultAbi } from "@/lib/abi";
import { byAddress } from "@/lib/catalog";
import { robinhood } from "@/lib/chain";
import { WETH } from "@/lib/config";
import {
  CURATOR_STRATEGIES,
  analyzeDrift,
  bpsToPct,
  draftFromOnChain,
  draftTotals,
  equalTargets,
  list696Targets,
  liveMixTargets,
  balanceDraftToCap,
  normalizeDraft,
  setSliderTarget,
  suggestBuyEth,
  trimDriftTargets,
  parkLegacyTargets,
  riskCap,
  vaultMcapTargets,
  curatorWorkflow,
  type McapRow,
  type StrategyId,
  type TargetDraft,
} from "@/lib/curator";
import { fmtUsdSleeve, formatEtherSafe, isAddress, shortAddr } from "@/lib/format";
import { deployableWethWei } from "@/lib/eject";
import { sleeveWethWei } from "@/lib/sleeveValue";
import { hydrateVaultCoins } from "@/lib/vaultCoins";
import { publicClient, useWallet } from "@/lib/wallet";
import { type Sleeve } from "@/lib/weights";
import snapshot from "../public/sleeves.json";

function draftStorageKey(vault: string) {
  return `hoodx-curator-draft:${vault.toLowerCase()}`;
}

type BagRow = {
  token: string;
  symbol: string;
  balanceWei: bigint;
  wethValueWei: bigint;
  onChainTargetBps: number;
  lastPxWad: bigint;
  currentPxWad: bigint;
};

export function CuratorBook({
  vault,
  onFocusSwap,
  onStatus,
}: {
  vault: string;
  onFocusSwap?: (token: string, side: "buy" | "sell", amountEth?: string) => void;
  onStatus?: (msg: string) => void;
}) {
  const { address, chainId, walletClient } = useWallet();
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<BagRow[]>([]);
  const [draft, setDraft] = useState<TargetDraft>({});
  const [navWei, setNavWei] = useState(0n);
  const [wethBagWei, setWethBagWei] = useState(0n);
  const [minSleeveWei, setMinSleeveWei] = useState(0n);
  const [cashBps, setCashBps] = useState(2500);
  const [ethUsd, setEthUsd] = useState(0);
  const [strategy, setStrategy] = useState<StrategyId | "custom">("custom");
  const [actionsOnly, setActionsOnly] = useState(true);
  const [baselineDraft, setBaselineDraft] = useState<TargetDraft>({});

  const focusSwap = useCallback(
    (token: string, side: "buy" | "sell", amountEth?: string) => {
      onFocusSwap?.(token, side, amountEth);
      requestAnimationFrame(() => {
        document.getElementById("vault-swaps")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [onFocusSwap],
  );

  const load = useCallback(async () => {
    if (!isAddress(vault)) return;
    const v = vault as Address;
    const [list, nav, minSleeve, cashTarget] = await Promise.all([
      publicClient.readContract({ address: v, abi: vaultAbi, functionName: "constituents" }),
      publicClient.readContract({ address: v, abi: vaultAbi, functionName: "totalAssets" }),
      publicClient.readContract({ address: v, abi: vaultAbi, functionName: "minSleeveWeth" }),
      publicClient.readContract({ address: v, abi: vaultAbi, functionName: "cashTargetBps" }),
    ]);
    const addrs = (list as Address[]) || [];
    await hydrateVaultCoins(v, addrs.map((a) => a.toLowerCase()));
    setNavWei(nav);
    setMinSleeveWei(minSleeve);
    setCashBps(Number(cashTarget));
    const wethBal = await publicClient.readContract({
      address: WETH,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [v],
    });
    setWethBagWei(wethBal);

    const tape = (await fetch(
      "https://api.dexscreener.com/tokens/v1/robinhood/0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    ).then((r) => r.json())) as { priceUsd?: string }[];
    const px = Number(tape?.[0]?.priceUsd);
    if (px > 0) setEthUsd(px);

    const out: BagRow[] = [];
    for (const token of addrs) {
      const [bal, target, lastPx] = await Promise.all([
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [v] }),
        publicClient.readContract({ address: v, abi: vaultAbi, functionName: "targetBps", args: [token] }),
        publicClient.readContract({ address: v, abi: vaultAbi, functionName: "lastPxWad", args: [token] }).catch(() => 0n),
      ]);
      let currentPx = 0n;
      let wethValue = 0n;
      try {
        currentPx = await publicClient.readContract({
          address: v,
          abi: vaultAbi,
          functionName: "priceWethWad",
          args: [token],
        });
      } catch {
        /* cold oracle */
      }
      if (currentPx <= 0n && lastPx) currentPx = lastPx as bigint;
      wethValue = await sleeveWethWei(v, token, bal);
      const coin = byAddress(token);
      out.push({
        token: token.toLowerCase(),
        symbol: coin?.symbol || shortAddr(token),
        balanceWei: bal,
        wethValueWei: wethValue,
        onChainTargetBps: Number(target),
        lastPxWad: lastPx as bigint,
        currentPxWad: currentPx,
      });
    }
    setRows(out);
    const targetMap = new Map(out.map((r) => [r.token, r.onChainTargetBps]));
    const onChain = draftFromOnChain(addrs.map((a) => a.toLowerCase()), targetMap);
    try {
      const saved = localStorage.getItem(draftStorageKey(vault));
      if (saved) {
        const parsed = JSON.parse(saved) as TargetDraft;
        const merged: TargetDraft = { ...onChain };
        for (const r of out) {
          if (typeof parsed[r.token] === "number") merged[r.token] = parsed[r.token];
        }
        setDraft(merged);
        setBaselineDraft(merged);
        return;
      }
    } catch {
      /* ignore corrupt draft */
    }
    setDraft(onChain);
    setBaselineDraft(onChain);
  }, [vault]);

  useEffect(() => {
    void load().catch(() => {});
  }, [load]);

  useEffect(() => {
    if (!isAddress(vault) || !Object.keys(draft).length) return;
    try {
      localStorage.setItem(draftStorageKey(vault), JSON.stringify(draft));
    } catch {
      /* quota / private mode */
    }
  }, [draft, vault]);

  const totals = useMemo(() => draftTotals(draft, cashBps), [draft, cashBps]);
  const deployableWei = useMemo(
    () => deployableWethWei(wethBagWei, navWei, cashBps),
    [wethBagWei, navWei, cashBps],
  );
  const navUsd = ethUsd > 0 ? Number(formatEther(navWei)) * ethUsd : 0;

  const mcapRows = useMemo<McapRow[]>(
    () =>
      rows.map((r) => {
        const coin = byAddress(r.token);
        const meta = coin as { buyTvlUsd?: number; mcapUsd?: number; vol24Usd?: number; hops?: number };
        return {
          token: r.token,
          mcapUsd: meta?.mcapUsd,
          buyTvlUsd: meta?.buyTvlUsd,
          vol24Usd: meta?.vol24Usd,
          hops: meta?.hops,
        };
      }),
    [rows],
  );

  const driftRows = useMemo(
    () =>
      analyzeDrift(
        rows.map((r) => ({
          token: r.token,
          symbol: r.symbol,
          balanceWei: r.balanceWei,
          wethValueWei: r.wethValueWei,
          onChainTargetBps: r.onChainTargetBps,
          draftBps: draft[r.token] || 0,
          lastPxWad: r.lastPxWad,
          currentPxWad: r.currentPxWad,
        })),
        navWei,
        ethUsd,
      ),
    [rows, draft, navWei, ethUsd],
  );

  const driftSummary = useMemo(() => {
    const buys = driftRows.filter((r) => r.action === "buy").length;
    const sells = driftRows.filter((r) => r.action === "sell" || r.action === "park").length;
    const driftUsd = driftRows.reduce((a, r) => a + Math.abs(r.plVsTargetUsd), 0);
    return { buys, sells, driftUsd };
  }, [driftRows]);

  const validation = useMemo(
    () => normalizeDraft(draft, rows.map((r) => r.token), navWei, minSleeveWei, cashBps),
    [draft, rows, navWei, minSleeveWei, cashBps],
  );

  const liveWethPct = navWei > 0n ? Number((wethBagWei * 10_000n) / navWei) / 100 : 0;
  const liveWethUsd = ethUsd > 0 ? Number(formatEtherSafe(wethBagWei)) * ethUsd : 0;

  const workflow = useMemo(
    () => curatorWorkflow(rows, draft, driftRows, deployableWei, validation.errors),
    [rows, draft, driftRows, deployableWei, validation.errors],
  );

  const hasBaseline = Object.keys(baselineDraft).length > 0;
  const draftEdited = useMemo(
    () => hasBaseline && rows.some((r) => (draft[r.token] ?? 0) !== (baselineDraft[r.token] ?? 0)),
    [draft, baselineDraft, hasBaseline, rows],
  );

  const visibleRows = useMemo(() => {
    if (draftEdited || !actionsOnly) return driftRows;
    return driftRows.filter((r) => r.action !== "hold");
  }, [actionsOnly, draftEdited, driftRows]);

  const legacyIds = useMemo(
    () =>
      new Set(
        ((snapshot.skipped || []) as { id: string }[])
          .concat((snapshot.dropped || []) as { id: string }[])
          .map((d) => d.id.toUpperCase()),
      ),
    [],
  );

  const buildStrategyDraft = useCallback(
    (id: StrategyId): TargetDraft => {
      const tokens = rows.map((r) => r.token);
      if (id === "equal") return equalTargets(tokens, cashBps);
      if (id === "mcap") return vaultMcapTargets(mcapRows, cashBps);
      if (id === "list696") {
        const sleeves = (snapshot.sleeves || []) as Sleeve[];
        return list696Targets(sleeves, tokens, navUsd, navWei, minSleeveWei, cashBps);
      }
      if (id === "live") {
        const live = rows.map((r) => ({
          token: r.token,
          liveBps: navWei > 0n ? Number((r.wethValueWei * 10_000n) / navWei) : 0,
        }));
        return liveMixTargets(live, cashBps);
      }
      if (id === "trim") {
        const live = rows.map((r) => ({
          token: r.token,
          liveBps: navWei > 0n ? Number((r.wethValueWei * 10_000n) / navWei) : 0,
          onChainTargetBps: r.onChainTargetBps,
        }));
        return trimDriftTargets(live, cashBps);
      }
      return parkLegacyTargets(
        rows.map((r) => {
          const coin = byAddress(r.token);
          const legacy = Boolean(
            coin && (legacyIds.has(coin.id.toUpperCase()) || legacyIds.has((coin.symbol || "").toUpperCase())),
          );
          return {
            token: r.token,
            balanceWei: r.balanceWei,
            onChainTargetBps: r.onChainTargetBps,
            legacy,
          };
        }),
        cashBps,
      );
    },
    [rows, cashBps, navUsd, navWei, minSleeveWei, legacyIds, mcapRows],
  );

  const applyStrategy = useCallback(
    (id: StrategyId) => {
      const next = buildStrategyDraft(id);
      setDraft(next);
      setBaselineDraft(next);
      setStrategy(id);
    },
    [buildStrategyDraft],
  );

  async function writeTargets() {
    if (!walletClient || !address || !isAddress(vault)) return;
    if (validation.errors.length) {
      onStatus?.(validation.errors[0]);
      return;
    }
    setBusy(true);
    try {
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "setTargets",
        args: [validation.who, validation.bps],
        chain: robinhood,
      });
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      if (rec.status !== "success") throw new Error("setTargets reverted");
      onStatus?.(`Targets saved · ${validation.who.length} names · ${totals.riskOnPct.toFixed(1)}% risk-on`);
      try {
        localStorage.removeItem(draftStorageKey(vault));
      } catch {
        /* private mode */
      }
      await load();
      setStrategy("custom");
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : "setTargets failed");
    } finally {
      setBusy(false);
    }
  }

  function undoDraftEdits() {
    if (!hasBaseline) return;
    setDraft({ ...baselineDraft });
    setStrategy("custom");
    onStatus?.("Sliders restored to your last saved plan");
  }

  function loadOnChainTargets() {
    const targetMap = new Map(rows.map((r) => [r.token, r.onChainTargetBps]));
    const onChain = draftFromOnChain(rows.map((r) => r.token), targetMap);
    setDraft(onChain);
    setBaselineDraft(onChain);
    setStrategy("custom");
    onStatus?.("Loaded on-chain targets");
  }

  function balanceDraft() {
    const next = balanceDraftToCap(draft, cashBps);
    setDraft(next);
    setStrategy("custom");
    onStatus?.(`Balanced to ${(riskCap(cashBps) / 100).toFixed(0)}% risk-on`);
  }

  const maxSliderPct = totals.cap / 100;

  function deployNextBuy() {
    const ranked = [...workflow.buyRows].sort((a, b) => Math.abs(b.plVsTargetUsd) - Math.abs(a.plVsTargetUsd));
    const top = ranked[0];
    if (!top) return;
    const eth = suggestBuyEth(top, navWei, wethBagWei, cashBps);
    focusSwap(top.token, "buy", eth > 0 ? formatEther(BigInt(Math.floor(eth * 1e18))) : undefined);
    onStatus?.(`Prefilled ${top.symbol} buy · scroll to Vault swaps`);
  }

  return (
    <div data-testid="curator-book" className="mt-4">
      <div
        data-testid="curator-workflow"
        className="rounded-xl border border-[var(--line)] bg-[var(--line)]/20 p-4"
      >
        <p className="text-[15px] font-medium text-[var(--paper)]">{workflow.headline}</p>
        <ol className="mt-3 grid gap-2 sm:grid-cols-3">
          {workflow.steps.map((s) => (
            <li
              key={s.n}
              className={`rounded-lg border px-3 py-2 text-[12px] leading-5 ${
                s.done
                  ? "border-[var(--mint)]/40 text-[var(--dim)]"
                  : s.active
                    ? "border-[var(--gold)]/50 bg-[var(--gold)]/5 text-[var(--paper)]"
                    : "border-[var(--line)] text-[var(--dim)]"
              }`}
            >
              <span className="font-medium">
                {s.n}. {s.title}
                {s.done ? " ✓" : ""}
              </span>
              <span className="mt-0.5 block">{s.body}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="text-[12px] leading-5 tabular text-[var(--dim)]">
          <p>
            <span className="text-[var(--paper)]">Live WETH</span> {liveWethPct.toFixed(1)}%
            {ethUsd > 0 ? ` (${fmtUsdSleeve(liveWethUsd)})` : ""}
            {" · "}
            <span className="text-[var(--paper)]">deployable</span> {formatEtherSafe(deployableWei)} ETH
          </p>
          <p className="mt-0.5">
            Draft targets {totals.riskOnPct.toFixed(1)}% in tokens
            {totals.over > 0
              ? ` · ${bpsToPct(totals.over).toFixed(1)}% over the ${bpsToPct(totals.cap).toFixed(0)}% cap`
              : totals.room > 0
                ? ` · ${bpsToPct(totals.room).toFixed(1)}% headroom (extra WETH)`
                : ""}
            {" · "}
            {(cashBps / 100).toFixed(0)}% cash floor
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {workflow.buyRows.length > 0 && deployableWei > 0n && !workflow.draftDirty && (
            <button
              type="button"
              data-testid="curator-deploy-next"
              disabled={busy || workflow.draftDirty}
              onClick={deployNextBuy}
              className="ape px-3 py-2 text-[12px]"
            >
              Deploy next buy
            </button>
          )}
          <button
            type="button"
            data-testid="curator-actions-toggle"
            onClick={() => setActionsOnly((v) => !v)}
            className="ghost px-3 py-2 text-[12px]"
          >
            {actionsOnly ? "Show all names" : "Needs action only"}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="strategy-mcap-primary"
          disabled={busy || !rows.length}
          title="Capped sqrt-mcap — good default"
          onClick={() => applyStrategy("mcap")}
          className={`ape px-3 py-2 text-[12px] ${strategy === "mcap" ? "ring-1 ring-[var(--gold)]" : ""}`}
        >
          Mcap weight
        </button>
        {CURATOR_STRATEGIES.filter((s) => s.id !== "mcap").map((s) => (
          <button
            key={s.id}
            type="button"
            data-testid={`strategy-${s.id}`}
            disabled={busy || !rows.length}
            title={s.hint}
            onClick={() => applyStrategy(s.id)}
            className={`ghost px-3 py-2 text-[12px] ${strategy === s.id ? "ring-1 ring-[var(--gold)]" : ""}`}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          data-testid="strategy-undo"
          disabled={busy || !draftEdited}
          title="Put sliders back to your last plan (strategy preset or page load)"
          onClick={undoDraftEdits}
          className="ghost px-3 py-2 text-[12px]"
        >
          Undo edits
        </button>
        {totals.over > 0 && (
          <button
            type="button"
            data-testid="strategy-balance"
            disabled={busy}
            title="Scale all targets down proportionally to fit the 75% risk cap"
            onClick={balanceDraft}
            className="ghost px-3 py-2 text-[12px]"
          >
            Balance to {(totals.cap / 100).toFixed(0)}%
          </button>
        )}
        <button
          type="button"
          data-testid="strategy-load-onchain"
          disabled={busy || !rows.length}
          title="Replace draft with targets saved on-chain"
          onClick={loadOnChainTargets}
          className="ghost px-3 py-2 text-[12px]"
        >
          Load on-chain
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-4 text-[12px] tabular text-[var(--dim)]">
        <span>{driftSummary.buys} underweight</span>
        <span>{driftSummary.sells} overweight / park</span>
        <span>
          Total drift{" "}
          {ethUsd > 0 ? fmtUsdSleeve(driftSummary.driftUsd) : `${(driftSummary.driftUsd / Math.max(ethUsd, 1)).toFixed(6)} ETH`}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--line)]">
        <table className="w-full min-w-[720px] text-left text-[12px]">
          <thead className="bg-[var(--line)]/30 text-[var(--dim)]">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Now</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2 text-right">Gap</th>
              <th className="px-3 py-2 text-right">Need</th>
              <th className="px-3 py-2 text-right">Do</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[var(--dim)]">
                  All names on target — use Show all names to edit sliders, or move a preset first.
                </td>
              </tr>
            ) : null}
            {visibleRows.map((r) => {
              const pct = (draft[r.token] || 0) / 100;
              const plTone =
                r.plVsTargetEth > 0.00005 ? "text-[var(--gold)]" : r.plVsTargetEth < -0.00005 ? "text-[var(--mint)]" : "";
              return (
                <tr key={r.token} className="border-t border-[var(--line)]">
                  <td className="px-3 py-3 font-medium">{r.symbol}</td>
                  <td className="px-3 py-3 text-right tabular">{(r.liveBps / 100).toFixed(2)}%</td>
                  <td className="px-3 py-3">
                    <div className="flex min-w-[140px] items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={maxSliderPct}
                        step={0.05}
                        value={pct}
                        data-testid={`slider-${r.symbol}`}
                        onChange={(e) => {
                          setStrategy("custom");
                          setDraft((cur) =>
                            setSliderTarget(cur, r.token, Math.round(Number(e.target.value) * 100), cashBps),
                          );
                        }}
                        className="h-1.5 flex-1 accent-[var(--gold)]"
                      />
                      <span className="w-12 text-right tabular text-[var(--paper)]">{pct.toFixed(2)}%</span>
                    </div>
                  </td>
                  <td
                    className={`px-3 py-3 text-right tabular ${
                      r.driftBps > 200 ? "text-[var(--gold)]" : r.driftBps < -200 ? "text-[var(--mint)]" : ""
                    }`}
                  >
                    {r.driftBps >= 0 ? "+" : ""}
                    {(r.driftBps / 100).toFixed(2)}%
                  </td>
                  <td className={`px-3 py-3 text-right tabular ${plTone}`}>
                    {r.action === "buy" ? "buy " : r.action === "sell" || r.action === "park" ? "sell " : ""}
                    {ethUsd > 0 ? fmtUsdSleeve(Math.abs(r.plVsTargetUsd)) : `${Math.abs(r.plVsTargetEth).toFixed(6)} ETH`}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {r.action === "hold" ? (
                      <span className="text-[var(--dim)]">hold</span>
                    ) : (
                      <button
                        type="button"
                        data-testid={`fix-${r.symbol}`}
                        className="ghost px-2 py-1 text-[11px]"
                        onClick={() => {
                          if (r.action === "buy") {
                            const eth = suggestBuyEth(r, navWei, wethBagWei, cashBps);
                            focusSwap(
                              r.token,
                              "buy",
                              eth > 0 ? formatEther(BigInt(Math.floor(eth * 1e18))) : undefined,
                            );
                          } else {
                            focusSwap(r.token, "sell");
                          }
                        }}
                      >
                        {r.action === "buy" ? "Buy" : r.action === "park" ? "Sell→cash" : "Sell"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {validation.errors.length > 0 && (
        <p data-testid="curator-errors" className="mt-3 text-[13px] text-[var(--gold)]">
          {validation.errors[0]}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="curator-write-targets"
          disabled={busy || chainId !== robinhood.id || validation.errors.length > 0 || !workflow.draftDirty}
          onClick={() => void writeTargets()}
          className="ape px-4"
        >
          {busy ? "Confirm…" : workflow.draftDirty ? "1. Write targets on-chain" : "Targets saved ✓"}
        </button>
      </div>
    </div>
  );
}
