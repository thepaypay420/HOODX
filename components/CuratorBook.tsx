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
  draftFromOnChain,
  draftTotals,
  equalTargets,
  list696Targets,
  liveMixTargets,
  normalizeDraft,
  resizeSliderTargets,
  trimDriftTargets,
  type StrategyId,
  type TargetDraft,
} from "@/lib/curator";
import { fmtPct, fmtUsdSleeve, formatEtherSafe, isAddress, shortAddr } from "@/lib/format";
import { sleeveWethWei } from "@/lib/sleeveValue";
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
  const [minSleeveWei, setMinSleeveWei] = useState(0n);
  const [cashBps, setCashBps] = useState(2500);
  const [ethUsd, setEthUsd] = useState(0);
  const [strategy, setStrategy] = useState<StrategyId | "custom">("custom");

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
    setNavWei(nav);
    setMinSleeveWei(minSleeve);
    setCashBps(Number(cashTarget));

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
        return;
      }
    } catch {
      /* ignore corrupt draft */
    }
    setDraft(onChain);
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
  const navUsd = ethUsd > 0 ? Number(formatEther(navWei)) * ethUsd : 0;

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

  const applyStrategy = useCallback(
    (id: StrategyId) => {
      const tokens = rows.map((r) => r.token);
      if (id === "equal") {
        setDraft(equalTargets(tokens, cashBps));
      } else if (id === "list696") {
        const sleeves = (snapshot.sleeves || []) as Sleeve[];
        setDraft(list696Targets(sleeves, tokens, navUsd, navWei, minSleeveWei, cashBps));
      } else if (id === "live") {
        const live = rows.map((r) => ({
          token: r.token,
          liveBps: navWei > 0n ? Number((r.wethValueWei * 10_000n) / navWei) : 0,
        }));
        setDraft(liveMixTargets(live, cashBps));
      } else if (id === "trim") {
        const live = rows.map((r) => ({
          token: r.token,
          liveBps: navWei > 0n ? Number((r.wethValueWei * 10_000n) / navWei) : 0,
          onChainTargetBps: r.onChainTargetBps,
        }));
        setDraft(trimDriftTargets(live, cashBps));
      }
      setStrategy(id);
    },
    [rows, cashBps, navUsd, navWei, minSleeveWei],
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
      await load();
      setStrategy("custom");
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : "setTargets failed");
    } finally {
      setBusy(false);
    }
  }

  function resetDraft() {
    const targetMap = new Map(rows.map((r) => [r.token, r.onChainTargetBps]));
    setDraft(draftFromOnChain(rows.map((r) => r.token), targetMap));
    setStrategy("custom");
    onStatus?.("Draft reset to on-chain targets");
  }

  const maxSliderPct = totals.cap / 100;

  return (
    <div data-testid="curator-book" className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-right text-[12px] tabular text-[var(--dim)] sm:ml-auto">
          <p>
            Risk-on{" "}
            <span className={totals.over > 0 ? "text-[var(--gold)]" : "text-[var(--paper)]"}>
              {totals.riskOnPct.toFixed(1)}%
            </span>{" "}
            · Cash {totals.cashPct.toFixed(1)}%
          </p>
          <p className="mt-0.5">Cap {maxSliderPct.toFixed(0)}% · room {totals.room / 100}%</p>
        </div>
      </div>

      <p className="mt-2 text-[14px] leading-6 text-[var(--dim)]">
        Slide each name to the sleeve you want. Cash stays at least {(cashBps / 100).toFixed(0)}% for exits.
        P/L vs target is mark-to-NAV drift — not your wallet ROI.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {CURATOR_STRATEGIES.map((s) => (
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
        <button type="button" data-testid="strategy-reset" disabled={busy} onClick={resetDraft} className="ghost px-3 py-2 text-[12px]">
          Reset draft
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
              <th className="px-3 py-2 text-right">Live</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2 text-right">Drift</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2 text-right">Mark Δ</th>
              <th className="px-3 py-2 text-right">vs target</th>
              <th className="px-3 py-2 text-right">Fix</th>
            </tr>
          </thead>
          <tbody>
            {driftRows.map((r) => {
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
                            resizeSliderTargets(cur, r.token, Math.round(Number(e.target.value) * 100), cashBps),
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
                  <td className="px-3 py-3 text-right tabular">{ethUsd > 0 ? fmtUsdSleeve(r.valueUsd) : `${r.valueEth.toFixed(6)} ETH`}</td>
                  <td className="px-3 py-3 text-right tabular">
                    {r.markDelta == null ? "—" : fmtPct(r.markDelta, 1)}
                  </td>
                  <td className={`px-3 py-3 text-right tabular ${plTone}`}>
                    {ethUsd > 0 ? fmtUsdSleeve(r.plVsTargetUsd) : `${r.plVsTargetEth.toFixed(6)} ETH`}
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
                            const eth = Math.min(r.swapEth, Number(formatEtherSafe(navWei)) * 0.15);
                            onFocusSwap?.(r.token, "buy", eth > 0 ? formatEther(BigInt(Math.floor(eth * 1e18))) : undefined);
                          } else {
                            onFocusSwap?.(r.token, "sell");
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
          disabled={busy || chainId !== robinhood.id || validation.errors.length > 0}
          onClick={() => void writeTargets()}
          className="ape px-4"
        >
          {busy ? "Confirm…" : "Write targets on-chain"}
        </button>
      </div>
    </div>
  );
}
