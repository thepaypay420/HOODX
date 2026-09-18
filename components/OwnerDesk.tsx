"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, parseEther, type Address } from "viem";
import { erc20Abi, vaultAbi } from "@/lib/abi";
import { INDEX_CATALOG, byAddress, CATALOG } from "@/lib/catalog";
import { robinhood } from "@/lib/chain";
import { USD_PER_SHARE, WETH, isLive696x } from "@/lib/config";
import { BLURB_EVENT, BLURB_MAX, defaultBlurb, readBlurb, writeBlurb } from "@/lib/blurbs";
import { buySlippageHint, isSlippageError, revertHint, sellBlocked, buyBlocked } from "@/lib/eject";
import { formatEtherSafe, fmtUsd, genesisEthWei, isAddress, shortAddr } from "@/lib/format";
import { publicClient, useWallet } from "@/lib/wallet";

function bagText(wei: bigint) {
  const n = Number(formatEtherSafe(wei));
  if (!Number.isFinite(n)) return formatEtherSafe(wei);
  if (n >= 100) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return formatEtherSafe(wei);
}

export function OwnerDesk({
  vault,
  slug = "",
  prefilledToken = "",
  prefilledSide = "sell",
  prefilledAmount = "",
}: {
  vault?: string;
  slug?: string;
  prefilledToken?: string;
  prefilledSide?: "buy" | "sell";
  prefilledAmount?: string;
}) {
  const live = isAddress(vault || "");
  const { address, chainId, walletClient } = useWallet();
  const [owner, setOwner] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [listed, setListed] = useState<Address[]>([]);
  const [bags, setBags] = useState<Record<string, bigint>>({});
  const [token, setToken] = useState(INDEX_CATALOG[0]?.token || "");
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [amount, setAmount] = useState("");
  const [minOut, setMinOut] = useState("");
  const [quoted, setQuoted] = useState("");
  const [shortfall, setShortfall] = useState(0n);
  const [assets, setAssets] = useState(0n);
  const [cashBps, setCashBps] = useState(2500);
  const [blurb, setBlurb] = useState(() => readBlurb(slug, vault));
  const [blurbSaved, setBlurbSaved] = useState("");

  const isOwner = Boolean(address && owner && address.toLowerCase() === owner.toLowerCase());
  const wethKey = WETH.toLowerCase();
  const tokenKey = token.toLowerCase();
  const bagWei = side === "sell" ? bags[tokenKey] || 0n : bags[wethKey] || 0n;
  const coin = byAddress(token);
  const catalogCoin = CATALOG.find((c) => c.token === tokenKey);
  const listedQuote = catalogCoin?.buyQuote || coin?.buyQuote;
  const symbol = coin?.symbol || shortAddr(token);
  const inSym = side === "sell" ? symbol : "WETH";
  const outSym = side === "sell" ? "WETH" : symbol;

  const loadBags = useCallback(async () => {
    if (!live || !vault) return;
    const [own, short, list, nav, cashTarget] = await Promise.all([
      publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "owner" }),
      publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "cashShortfall" }),
      publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "constituents" }),
      publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "totalAssets" }),
      publicClient.readContract({ address: vault as Address, abi: vaultAbi, functionName: "cashTargetBps" }),
    ]);
    setOwner(own);
    setShortfall(short);
    setAssets(nav);
    setCashBps(Number(cashTarget));
    const addrs = (list as Address[]) || [];
    setListed(addrs);
    const bagAddrs = [WETH as Address, ...addrs];
    const bals = await Promise.all(
      bagAddrs.map((t) =>
        publicClient
          .readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [vault as Address] })
          .catch(() => 0n),
      ),
    );
    const next: Record<string, bigint> = {};
    bagAddrs.forEach((t, i) => {
      next[t.toLowerCase()] = bals[i];
    });
    setBags(next);
    setToken((cur) => {
      if (cur && addrs.some((a) => a.toLowerCase() === cur.toLowerCase())) return cur;
      const held = addrs.find((a) => (next[a.toLowerCase()] || 0n) > 0n);
      return held || addrs[0] || cur;
    });
  }, [live, vault]);

  useEffect(() => {
    void loadBags().catch(() => {});
  }, [loadBags]);

  useEffect(() => {
    if (!prefilledToken) return;
    setToken(prefilledToken);
    setSide(prefilledSide);
    if (prefilledAmount) setAmount(prefilledAmount);
  }, [prefilledToken, prefilledSide, prefilledAmount]);

  useEffect(() => {
    const sync = () => setBlurb(readBlurb(slug, vault));
    sync();
    window.addEventListener(BLURB_EVENT, sync);
    return () => window.removeEventListener(BLURB_EVENT, sync);
  }, [slug, vault]);

  useEffect(() => {
    if (side !== "sell") return;
    if (bagWei <= 0n) return;
    setAmount((cur) => {
      if (cur.trim()) return cur;
      return formatEther(bagWei);
    });
  }, [token, side, bagWei]);

  async function liveQuote(tokenIn: Address, tokenOut: Address, amt: bigint) {
    const twapOut = await publicClient.readContract({
      address: vault as Address,
      abi: vaultAbi,
      functionName: "quoteOut",
      args: [tokenIn, tokenOut, amt],
    });
    const floor = await publicClient.readContract({
      address: vault as Address,
      abi: vaultAbi,
      functionName: "minOutFloor",
      args: [twapOut],
    });
    return { twapOut, floor };
  }

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
    const tokenIn = side === "buy" ? (WETH as Address) : (token as Address);
    const tokenOut = side === "buy" ? (token as Address) : (WETH as Address);
    void liveQuote(tokenIn, tokenOut, amt)
      .then(({ twapOut, floor }) => {
        setQuoted(twapOut.toString());
        setMinOut(floor.toString());
      })
      .catch(() => setQuoted(""));
  }, [amount, side, token, live, vault]);


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
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      if (rec.status !== "success") throw new Error("peg tx reverted");
      setMsg(`genesis ${fmtUsd(USD_PER_SHARE, 0)}/share (${formatEther(wei)} ETH)`);
    } catch (e) {
      setMsg(revertHint(e));
    } finally {
      setBusy(false);
    }
  }

  async function quoteFloor(tokenIn: Address, tokenOut: Address, amt: bigint) {
    let last = { twapOut: 0n, floor: 0n };
    for (let i = 0; i < 3; i++) {
      last = await liveQuote(tokenIn, tokenOut, amt);
      if (last.floor > 0n) return last;
    }
    return last;
  }

  async function sendSwap(tokenIn: Address, tokenOut: Address, amt: bigint) {
    if (!walletClient || !address || !vault) throw new Error("connect the curator wallet");
    let { twapOut, floor } = await quoteFloor(tokenIn, tokenOut, amt);
    if (floor === 0n) throw new Error("no TWAP quote");
    setQuoted(twapOut.toString());
    setMinOut(floor.toString());
    const send = async (min: bigint) => {
      await publicClient.simulateContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "swapV3",
        args: [tokenIn, tokenOut, amt, min],
      });
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "swapV3",
        args: [tokenIn, tokenOut, amt, min],
        chain: robinhood,
      });
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      if (rec.status !== "success") throw new Error("swap reverted");
      return rec;
    };
    try {
      await send(floor);
    } catch (e) {
      const hint = revertHint(e);
      if (!hint.includes("97% TWAP floor") && !hint.includes("could not fill") && !hint.includes("cash floor")) {
        throw e;
      }
      ({ twapOut, floor } = await quoteFloor(tokenIn, tokenOut, amt));
      if (floor === 0n) throw e;
      setQuoted(twapOut.toString());
      setMinOut(floor.toString());
      await send(floor);
    }
  }

  async function swap() {
    if (!live || !vault || !walletClient || !address) return;
    let amt = 0n;
    try {
      amt = parseEther(amount || "0");
    } catch {
      amt = 0n;
    }
    const blocked =
      side === "buy"
        ? buyBlocked(amt, bags[wethKey] || 0n, assets, cashBps)
        : sellBlocked(amt, bagWei, inSym, bagText(bagWei));
    if (blocked) {
      setMsg(blocked);
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const tokenIn = side === "buy" ? (WETH as Address) : (token as Address);
      const tokenOut = side === "buy" ? (token as Address) : (WETH as Address);
      await sendSwap(tokenIn, tokenOut, amt);
      await loadBags();
      setMsg(
        side === "buy"
          ? `swap confirmed — ${bagText(amt)} WETH → ${outSym}`
          : `swap confirmed — ${bagText(amt)} ${inSym} → WETH`,
      );
      if (side === "sell") setAmount("");
    } catch (e) {
      setMsg(
        side === "buy" && isSlippageError(e)
          ? buySlippageHint(symbol, listedQuote)
          : revertHint(e),
      );
    } finally {
      setBusy(false);
    }
  }

  async function ejectBag() {
    if (!live || !vault || !walletClient || !address) return;
    setBusy(true);
    setMsg("");
    try {
      const liveBag = await publicClient.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [vault as Address],
      });
      if (liveBag > 0n) {
        setSide("sell");
        setAmount(formatEther(liveBag));
        await sendSwap(token as Address, WETH as Address, liveBag);
      }
      const left = await publicClient.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [vault as Address],
      });
      if (left !== 0n) throw new Error(`${symbol} bag still in the vault`);
      const hash = await walletClient.writeContract({
        account: address,
        address: vault as Address,
        abi: vaultAbi,
        functionName: "removeToken",
        args: [token as Address],
        chain: robinhood,
      });
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      if (rec.status !== "success") throw new Error("removeToken reverted");
      await loadBags();
      setAmount("");
      setMsg(`${symbol} sold to WETH and dropped from the book`);
    } catch (e) {
      setMsg(revertHint(e));
      await loadBags().catch(() => {});
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
      const rec = await publicClient.waitForTransactionReceipt({ hash });
      if (rec.status !== "success") throw new Error("restore tx reverted");
      setMsg("sold back to WETH toward the cash floor");
      await loadBags();
    } catch (e) {
      setMsg(revertHint(e));
    } finally {
      setBusy(false);
    }
  }

  const options = useMemo(() => {
    const seen = new Set<string>();
    const rows: { token: string; label: string }[] = [];
    for (const t of listed) {
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const c = byAddress(t);
      const wei = bags[k] || 0n;
      const name = c?.symbol || shortAddr(t);
      rows.push({ token: k, label: wei > 0n ? `${name} · ${bagText(wei)}` : name });
    }
    for (const c of INDEX_CATALOG) {
      if (seen.has(c.token)) continue;
      seen.add(c.token);
      rows.push({ token: c.token, label: c.symbol });
    }
    return rows;
  }, [listed, bags]);

  if (!live || !isOwner) return null;

  const wethBag = bags[wethKey] || 0n;
  const maxBuyWei =
    side === "buy" && assets > 0n && cashBps > 0 && wethBag > (assets * BigInt(cashBps)) / 10_000n
      ? wethBag - (assets * BigInt(cashBps)) / 10_000n
      : wethBag;
  const quoteWei = (() => {
    try {
      return BigInt(quoted || "0");
    } catch {
      return 0n;
    }
  })();

  return (
    <section id="vault-swaps" data-testid="owner-desk" className="holo p-4 sm:p-5">
      <p className="text-[13px] text-[var(--dim)]">Owner · {shortAddr(owner)}</p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Vault swaps</h2>
      <p className="mt-2 text-[15px] leading-6 text-[var(--dim)]">
        Amount in is vault tokens, not a guess. Max fills the bag. Buys send the 97% TWAP floor
        (V4 pools fill there, not at the headline quote). Sell & drop sells to WETH then removeToken.
        {isLive696x(vault) ? " Redeem stays open. No pause or floor controls here." : ""}
      </p>
      <label className="mt-5 block text-[11px] text-[var(--dim)]">
        Description
        <textarea
          data-testid="owner-blurb"
          value={blurb}
          maxLength={BLURB_MAX}
          onChange={(e) => {
            setBlurb(e.target.value);
            setBlurbSaved("");
          }}
          className="field mt-1 min-h-[5.5rem] resize-y text-[15px] font-medium leading-6 text-[#e8f3f0]"
          placeholder="A line beside the name — curator subtext."
        />
      </label>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[12px] tabular text-[var(--dim)]">
          {blurb.length}/{BLURB_MAX}
          {blurbSaved ? ` · ${blurbSaved}` : ""}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="owner-blurb-reset"
            className="ghost h-9 px-3 text-[12px]"
            onClick={() => {
              writeBlurb(slug, vault, "");
              setBlurb(defaultBlurb(slug));
              setBlurbSaved("Reset");
            }}
          >
            Reset
          </button>
          <button
            type="button"
            data-testid="owner-blurb-save"
            className="ghost h-9 px-3 text-[12px]"
            onClick={() => {
              writeBlurb(slug, vault, blurb);
              setBlurbSaved("Saved");
            }}
          >
            Save
          </button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
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
            value={tokenKey}
            onChange={(e) => {
              setToken(e.target.value);
              setAmount("");
            }}
            className="field mt-1 text-sm"
          >
            {options.map((c) => (
              <option key={c.token} value={c.token}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] text-[var(--dim)]">
          Side
          <select
            data-testid="owner-side"
            value={side}
            onChange={(e) => {
              setSide(e.target.value as "buy" | "sell");
              setAmount("");
            }}
            className="field mt-1 text-sm"
          >
            <option value="buy">WETH → {symbol}</option>
            <option value="sell">{symbol} → WETH</option>
          </select>
        </label>
        <label className="block text-[11px] text-[var(--dim)]">
          Amount in ({inSym})
          <span className="mt-1 flex gap-2">
            <input
              data-testid="owner-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="field flex-1"
              placeholder={bagWei > 0n ? bagText(bagWei) : "0"}
            />
            <button
              type="button"
              data-testid="owner-max"
              className="ghost h-10 px-3 text-[12px]"
              onClick={() => {
                const cap = side === "buy" ? maxBuyWei : bagWei;
                if (cap <= 0n) return;
                setAmount(formatEther(cap));
              }}
            >
              Max
            </button>
          </span>
          <span data-testid="owner-bag" className="mt-1 block text-[12px] text-[var(--paper)]">
            Vault holds {bagText(bagWei)} {inSym}
            {side === "buy" && maxBuyWei < wethBag ? ` · max buy ${bagText(maxBuyWei)} WETH` : ""}
          </span>
        </label>
        <label className="block text-[11px] text-[var(--dim)]">
          Quote out ({outSym}
          {quoteWei > 0n ? " · TWAP" : ""})
          <input
            data-testid="owner-quote"
            readOnly
            value={quoteWei > 0n ? formatEther(quoteWei) : ""}
            className="field mt-1 opacity-80"
            placeholder="quotes on amount"
          />
        </label>
        <label className="block text-[11px] text-[var(--dim)] sm:col-span-2">
          Min out ({outSym}
          {minOut ? " · 97% floor sent on-chain" : ""})
          <input
            data-testid="owner-minout"
            readOnly
            value={(() => {
              try {
                const v = BigInt(minOut || "0");
                return v > 0n ? formatEther(v) : "";
              } catch {
                return "";
              }
            })()}
            className="field mt-1 opacity-80"
            placeholder="quotes on amount"
          />
        </label>
      </div>
      {listedQuote && !["ETH", "WETH"].includes(listedQuote.toUpperCase()) && (
        <p className="mt-3 text-[13px] leading-5 text-[var(--dim)]">
          DexScreener book: {symbol}/{listedQuote.toUpperCase()}. Rebalance routes WETH → {listedQuote.toUpperCase()} →{" "}
          {symbol} once the vault runs quote-bind bytecode.
        </p>
      )}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          data-testid="owner-swap"
          disabled={busy || chainId !== robinhood.id}
          onClick={() => void swap()}
          className="ape w-full"
        >
          {busy ? "Confirm…" : "Swap in the vault"}
        </button>
        <button
          type="button"
          data-testid="owner-eject"
          disabled={busy || chainId !== robinhood.id || side === "buy"}
          onClick={() => void ejectBag()}
          className="ghost w-full"
        >
          Sell & drop
        </button>
      </div>
      {msg && (
        <p data-testid="owner-msg" className="mt-3 text-sm text-[var(--gold)]">
          {msg}
        </p>
      )}
    </section>
  );
}
