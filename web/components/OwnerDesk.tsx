"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { vaultAbi } from "@/lib/abi";
import { INDEX_CATALOG, byAddress } from "@/lib/catalog";
import { robinhood } from "@/lib/chain";
import { USD_PER_SHARE, WETH, isLive696x } from "@/lib/config";
import { fmtUsd, genesisEthWei, isAddress, shortAddr } from "@/lib/format";
import { publicClient, useWallet } from "@/lib/wallet";
import { listTargetBps, type Sleeve } from "@/lib/weights";
import snapshot from "../public/sleeves.json";

export function OwnerDesk({ vault }: { vault?: string }) {
  const live = isAddress(vault || "");
  const { address, chainId, walletClient } = useWallet();
  const [owner, setOwner] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(INDEX_CATALOG[0]?.token || "");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0.01");
  const [minOut, setMinOut] = useState("");
  const [quoted, setQuoted] = useState("");
  const [shortfall, setShortfall] = useState(0n);

  const isOwner = Boolean(address && owner && address.toLowerCase() === owner.toLowerCase());

  useEffect(() => {
    if (!live || !vault) return;
    publicClient
      .readContract({ address: vault as Address, abi: vaultAbi, functionName: "owner" })
      .then((o) => setOwner(o))
      .catch(() => setOwner(""));
    publicClient
      .readContract({ address: vault as Address, abi: vaultAbi, functionName: "cashShortfall" })
      .then((s) => setShortfall(s))
      .catch(() => setShortfall(0n));
  }, [live, vault]);

  useEffect(() => {
    let amt = 0n;
    try {
      amt = parseEther(amount || "0");
    } catch {
      amt = 0n;
    }
    if (!live || !vault || amt === 0n || !isAddress(token)) {
      setQuoted("");
      return;
    }
    const tokenIn = side === "buy" ? WETH : (token as Address);
    const tokenOut = side === "buy" ? (token as Address) : WETH;
    publicClient
      .readContract({
        address: vault as Address,
        abi: vaultAbi,
        functionName: "quoteOut",
        args: [tokenIn, tokenOut, amt],
      })
      .then(async (twapOut) => {
        const floor = await publicClient.readContract({
          address: vault as Address,
          abi: vaultAbi,
          functionName: "minOutFloor",
          args: [twapOut],
        });
        setQuoted(floor.toString());
        setMinOut(floor.toString());
      })
      .catch(() => setQuoted(""));
  }, [amount, side, token, live, vault]);

  const equalTargets = useCallback(async () => {
    if (!live || !vault || !walletClient || !address) return;
    setBusy(true);
    setMsg("");
    try {
      const listed = (await publicClient.readContract({
        address: vault as Address,
        abi: vaultAbi,
        functionName: "constituents",
      })) as Address[];
      const n = listed.length;
      if (n < 2) throw new Error("need 2 names");
      const each = Math.floor(7500 / n);
      const bps = listed.map(() => each);
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "setTargets",
        args: [listed, bps],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg(`targets ${each} bps × ${n} (25% cash floor)`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 160) : "failed");
    } finally {
      setBusy(false);
    }
  }, [live, vault, walletClient, address]);

  const listTargets = useCallback(async () => {
    if (!live || !vault || !walletClient || !address) return;
    setBusy(true);
    setMsg("");
    try {
      const listed = (await publicClient.readContract({
        address: vault as Address,
        abi: vaultAbi,
        functionName: "constituents",
      })) as Address[];
      const [nav, minSleeve, cashBps] = await Promise.all([
        publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "totalAssets" }),
        publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "minSleeveWeth" }),
        publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "cashTargetBps" }),
      ]);
      const rows = (await fetch(
        "https://api.dexscreener.com/tokens/v1/robinhood/0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      ).then((r) => r.json())) as { priceUsd?: string }[];
      const px = Number(rows?.[0]?.priceUsd);
      const navUsd = px > 0 ? Number(formatEther(nav)) * px : 0;
      const sleeves = (snapshot.sleeves || []) as Sleeve[];
      const { who, bps } = listTargetBps(sleeves, listed, navUsd, nav, minSleeve, Number(cashBps));
      if (who.length < 2) throw new Error("need 2 names above the sleeve floor");
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "setTargets",
        args: [who, bps],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg(`696 list targets · ${who.length} names · ${(bps.reduce((a, b) => a + b, 0) / 100).toFixed(1)}% risk-on`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 160) : "failed");
    } finally {
      setBusy(false);
    }
  }, [live, vault, walletClient, address]);

  async function pegHundred() {
    if (!live || !vault || !walletClient || !address) return;
    setBusy(true);
    setMsg("");
    try {
      const rows = (await fetch(
        "https://api.dexscreener.com/tokens/v1/robinhood/0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      ).then((r) => r.json())) as { priceUsd?: string }[];
      const px = Number(rows?.[0]?.priceUsd);
      if (!(px > 0) || !Number.isFinite(px)) throw new Error("no ETH/USD tape");
      const wei = genesisEthWei(USD_PER_SHARE, px);
      const lo = parseEther("0.01");
      const hi = parseEther("0.25");
      if (wei < lo || wei > hi) throw new Error("ETH/USD tape out of peg bounds");
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "setGenesisEthPerShare",
        args: [wei],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg(`genesis ${fmtUsd(USD_PER_SHARE, 0)}/share (${formatEther(wei)} ETH)`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 160) : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function swap() {
    if (!live || !vault || !walletClient || !address) return;
    const amt = parseEther(amount || "0");
    const min = BigInt(minOut || "0");
    if (amt === 0n || min === 0n) {
      setMsg("amount and min out must be > 0");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const tokenIn = side === "buy" ? WETH : (token as Address);
      const tokenOut = side === "buy" ? (token as Address) : WETH;
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "swapV3",
        args: [tokenIn, tokenOut, amt, min],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg("swap confirmed — 3% min-out bound the fill");
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 160) : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!live || !vault || !walletClient || !address) return;
    const amt = parseEther(amount || "0");
    if (amt === 0n) {
      setMsg("amount in must be > 0");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "restoreCash",
        args: [token as Address, amt],
        chain: robinhood,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setMsg("sold back to WETH toward the cash floor");
    } catch (e) {
      setMsg(e instanceof Error ? e.message.slice(0, 160) : "failed");
    } finally {
      setBusy(false);
    }
  }

  if (!live || !isOwner) return null;
  const coin = byAddress(token);

  return (
    <section data-testid="owner-desk" className="holo p-4 sm:p-5">
      <p className="text-[13px] text-[var(--dim)]">Owner · {shortAddr(owner)}</p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Rebalance</h2>
      <p className="mt-2 text-[15px] leading-6 text-[var(--dim)]">
        First mint used equal sleeves. 696 list is capped sqrt-mcap — apply it, then swap drift.
        {isLive696x(vault) ? " Redeem stays open. No pause or floor controls here." : ""}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="owner-list-weights"
          disabled={busy || chainId !== robinhood.id}
          onClick={() => void listTargets()}
          className="ghost px-4"
        >
          696 list weights
        </button>
        <button
          type="button"
          data-testid="owner-equal"
          disabled={busy || chainId !== robinhood.id}
          onClick={() => void equalTargets()}
          className="ghost px-4"
        >
          Equal weights
        </button>
        <button
          type="button"
          data-testid="owner-peg"
          disabled={busy || chainId !== robinhood.id}
          onClick={() => void pegHundred()}
          className="ghost px-4"
        >
          Peg ${USD_PER_SHARE}/share
        </button>
        {shortfall > 0n && (
          <button
            type="button"
            data-testid="owner-restore"
            disabled={busy || chainId !== robinhood.id}
            onClick={() => void restore()}
            className="ghost px-4"
          >
            Restore cash
          </button>
        )}
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block text-[11px] text-[var(--dim)]">
          Name
          <select
            data-testid="owner-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="field mt-1 text-sm"
          >
            {INDEX_CATALOG.map((c) => (
              <option key={c.token} value={c.token}>
                {c.symbol}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] text-[var(--dim)]">
          Side
          <select
            data-testid="owner-side"
            value={side}
            onChange={(e) => setSide(e.target.value as "buy" | "sell")}
            className="field mt-1 text-sm"
          >
            <option value="buy">WETH → {coin?.symbol || "token"}</option>
            <option value="sell">{coin?.symbol || "token"} → WETH</option>
          </select>
        </label>
        <label className="block text-[11px] text-[var(--dim)]">
          Amount in
          <input
            data-testid="owner-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="field mt-1"
          />
        </label>
        <label className="block text-[11px] text-[var(--dim)]">
          Min out (wei{quoted ? " · 3% floor" : ""})
          <input
            data-testid="owner-minout"
            value={minOut}
            onChange={(e) => setMinOut(e.target.value)}
            className="field mt-1"
          />
        </label>
      </div>
      <button
        type="button"
        data-testid="owner-swap"
        disabled={busy || chainId !== robinhood.id}
        onClick={() => void swap()}
        className="ape mt-4 w-full"
      >
        {busy ? "Confirm…" : "Swap in the vault"}
      </button>
      {msg && (
        <p data-testid="owner-msg" className="mt-3 text-sm text-[var(--gold)]">
          {msg}
        </p>
      )}
    </section>
  );
}
