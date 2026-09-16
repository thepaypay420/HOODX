"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, parseEther, zeroAddress, type Address } from "viem";
import { vaultAbi } from "@/lib/abi";
import { robinhood } from "@/lib/chain";
import {
  CASH_TARGET,
  CREATOR_FEE_BPS,
  ETH_USD_REF,
  EXPLORER,
  ISSUE_FEE_BPS,
  MIN_CREATE_FIRST_ETH,
  MIN_DEPOSIT_ETH,
  MIN_FIRST_ETH,
  MIN_SLEEVE_USD,
  PROTOCOL_FEE_BPS,
  TWEET,
} from "@/lib/config";
import { fmtEth, fmtUsd, isAddress, shortAddr } from "@/lib/format";
import { publicClient, useWallet } from "@/lib/wallet";
import { activeBook, issueSplit, type Sleeve } from "@/lib/weights";
import snapshot from "../public/sleeves.json";

type VaultSnap = {
  assets: bigint;
  supply: bigint;
  buffer: bigint;
  paused: boolean;
  feeBps: number;
  creatorBps: number;
  protocolBps: number;
  userShares: bigint;
  symbol: string;
};

export function VaultDesk({
  slug,
  vault: vaultProp,
  isGen0,
}: {
  slug: string;
  vault?: string;
  isGen0: boolean;
}) {
  const live = isAddress(vaultProp || "") && vaultProp!.toLowerCase() !== zeroAddress;
  const vault = live ? (vaultProp as Address) : undefined;
  const [sleeves] = useState<Sleeve[]>(() =>
    isGen0 ? ((snapshot.sleeves || []) as Sleeve[]) : [],
  );
  const [dead] = useState<{ id: string; reason: string }[]>(() =>
    isGen0 ? ((snapshot.dropped || snapshot.skipped || []) as { id: string; reason: string }[]) : [],
  );
  const [ethUsd, setEthUsd] = useState(ETH_USD_REF);
  const [joinAmt, setJoinAmt] = useState(isGen0 ? "0.08" : "0.02");
  const [leaveAmt, setLeaveAmt] = useState("");
  const [snap, setSnap] = useState<VaultSnap | null>(null);
  const [onchainJoin, setOnchainJoin] = useState<{ shares: bigint; fee: bigint } | null>(null);
  const [leaveNet, setLeaveNet] = useState<bigint | null>(null);
  const [canLeave, setCanLeave] = useState<boolean | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [txErr, setTxErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  const { address, chainId, walletClient } = useWallet();
  const isConnected = Boolean(address);
  const wrongChain = isConnected && chainId !== robinhood.id;

  useEffect(() => {
    fetch("https://api.dexscreener.com/tokens/v1/robinhood/0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73")
      .then((r) => r.json())
      .then((rows: { priceUsd?: string }[]) => {
        const px = Number(rows?.[0]?.priceUsd);
        if (px > 0) setEthUsd(px);
      })
      .catch(() => {});
  }, []);

  const loadVault = useCallback(async () => {
    if (!vault) {
      setSnap(null);
      return;
    }
    const [assets, supply, buffer, paused, feeBps, creatorBps, protocolBps, symbol] = await Promise.all([
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "wethBuffer" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "paused" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "issueFeeBps" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "creatorFeeBps" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "protocolFeeBps" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "symbol" }),
    ]);
    let userShares = 0n;
    if (address) {
      userShares = await publicClient.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "balanceOf",
        args: [address],
      });
    }
    setSnap({
      assets,
      supply,
      buffer,
      paused,
      feeBps: Number(feeBps),
      creatorBps: Number(creatorBps),
      protocolBps: Number(protocolBps),
      userShares,
      symbol,
    });
  }, [vault, address]);

  useEffect(() => {
    void loadVault().catch(() => setSnap(null));
  }, [loadVault]);

  const navEth = snap && snap.assets > 0n ? Number(formatEther(snap.assets)) : 0;
  const displayNavUsd = navEth > 0 ? navEth * ethUsd : isGen0 ? 200 : 0;
  const book = useMemo(
    () => (sleeves.length ? activeBook(sleeves, displayNavUsd || 200, MIN_SLEEVE_USD, CASH_TARGET) : null),
    [sleeves, displayNavUsd],
  );

  const joinWei = (() => {
    try {
      return parseEther(joinAmt || "0");
    } catch {
      return 0n;
    }
  })();
  const leaveWei = (() => {
    try {
      return leaveAmt ? parseEther(leaveAmt) : 0n;
    } catch {
      return 0n;
    }
  })();

  const feeBps = snap?.feeBps ?? ISSUE_FEE_BPS;
  const creatorBps = snap?.creatorBps ?? CREATOR_FEE_BPS;
  const protocolBps = snap?.protocolBps ?? PROTOCOL_FEE_BPS;
  const token = snap?.symbol || (isGen0 ? "696X" : slug.toUpperCase());
  const onchainSupply = snap?.supply ?? 0n;
  const paused = Boolean(snap?.paused);
  const minFirst = isGen0 ? MIN_FIRST_ETH : MIN_CREATE_FIRST_ETH;
  const localJoin = issueSplit(joinWei, BigInt(feeBps));
  const joinShares = onchainJoin?.shares ?? localJoin.net;
  const joinFee = onchainJoin?.fee ?? localJoin.fee;

  useEffect(() => {
    if (!vault || joinWei === 0n) {
      setOnchainJoin(null);
      return;
    }
    publicClient
      .readContract({ address: vault, abi: vaultAbi, functionName: "previewDeposit", args: [joinWei] })
      .then((out) => setOnchainJoin({ shares: out[0], fee: out[1] }))
      .catch(() => setOnchainJoin(null));
  }, [vault, joinWei]);

  useEffect(() => {
    if (!vault || leaveWei === 0n) {
      setLeaveNet(null);
      setCanLeave(null);
      return;
    }
    Promise.all([
      publicClient.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "previewWithdraw",
        args: [leaveWei],
      }),
      publicClient.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "canWithdraw",
        args: [leaveWei],
      }),
    ])
      .then(([preview, ok]) => {
        setLeaveNet(preview[0]);
        setCanLeave(ok);
      })
      .catch(() => {
        setLeaveNet(null);
        setCanLeave(null);
      });
  }, [vault, leaveWei]);

  async function onJoin() {
    if (!vault || !walletClient || !address) return;
    setBusy(true);
    setTxErr(null);
    setConfirmed(false);
    try {
      const hash = await walletClient.writeContract({
        account: address,
        address: vault,
        abi: vaultAbi,
        functionName: "deposit",
        value: joinWei,
        chain: robinhood,
      });
      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      setConfirmed(true);
      await loadVault();
    } catch (e) {
      setTxErr(e instanceof Error ? e.message.slice(0, 280) : "tx failed");
    } finally {
      setBusy(false);
    }
  }

  async function onLeave() {
    if (!vault || !walletClient || !address) return;
    setBusy(true);
    setTxErr(null);
    setConfirmed(false);
    try {
      const hash = await walletClient.writeContract({
        account: address,
        address: vault,
        abi: vaultAbi,
        functionName: "withdraw",
        args: [leaveWei],
        chain: robinhood,
      });
      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      setConfirmed(true);
      await loadVault();
    } catch (e) {
      setTxErr(e instanceof Error ? e.message.slice(0, 280) : "tx failed");
    } finally {
      setBusy(false);
    }
  }

  const minJoin = onchainSupply === 0n ? minFirst : MIN_DEPOSIT_ETH;
  const joinTooSmall = Number(joinAmt || 0) > 0 && Number(joinAmt) < minJoin - 1e-12;

  function share() {
    const url = `${window.location.origin}/i/${slug}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-[var(--dim)]">
            {isGen0 ? "Mint" : `Mint · /${slug}`}
          </p>
          <h1 className="mt-1 hidden font-[family-name:var(--font-display)] text-4xl leading-none sm:block sm:text-5xl">
            ${token}
          </h1>
          <p className="mt-2 max-w-xl text-[15px] leading-6 text-[var(--dim)]">
            {isGen0
              ? "ETH in, one token out. Sleeves under $10 stay in ETH so the tail is never dust."
              : "A shared basket. Send ETH, receive the index. The creator takes a cut on volume."}
          </p>
        </div>
        <button type="button" onClick={share} className="ghost h-11 shrink-0 rounded-sm px-3 text-xs sm:px-4">
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-2 sm:mt-8 sm:grid-cols-4 sm:gap-3">
        <Stat
          label="NAV"
          value={displayNavUsd ? fmtUsd(displayNavUsd, 0) : "—"}
          hint={live && snap && snap.assets > 0n ? fmtEth(snap.assets, 4) : isGen0 ? "plan $200" : "not live"}
        />
        <Stat
          label="Cash buffer"
          value={book ? `${(book.cashWeight * 100).toFixed(0)}%` : "—"}
          hint={book ? `${fmtUsd(book.cashUsd, 0)} for ETH exits` : "ETH exits"}
        />
        <Stat
          label="Join fee"
          value={`${(feeBps / 100).toFixed(2)}%`}
          hint={`${(creatorBps / 100).toFixed(2)}% creator · ${(protocolBps / 100).toFixed(2)}% protocol`}
        />
        <Stat
          label="Smart floor"
          value={fmtUsd(MIN_SLEEVE_USD, 0)}
          hint={book ? `${book.nActive} held · ${book.nSkipped} waiting` : "no dust bags"}
        />
      </section>

      {!live && (
        <p className="holo mt-5 rounded-lg px-4 py-3 text-sm text-[var(--dim)]">
          {isGen0
            ? "Factory is not deployed yet. This is the $200 696X book. Mint wires up when the vault address is set."
            : "Unknown slug, or factory not live. Create a basket from /create."}
        </p>
      )}
      {paused && (
        <p className="mt-5 rounded-lg border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-3 text-sm text-[var(--gold)]">
          Vault is paused.
        </p>
      )}

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="holo rounded-2xl p-4 sm:p-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">Join</h2>
          <p className="mt-1 text-[15px] leading-6 text-[var(--dim)]">
            Send ETH. Wrap, take {(feeBps / 100).toFixed(2)}%, mint ${token}. First mint ≥ {minFirst} ETH.
            Later ≥ {MIN_DEPOSIT_ETH} ETH.
          </p>
          <label className="mt-4 block font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-[var(--dim)]">
            ETH
          </label>
          <input
            value={joinAmt}
            onChange={(e) => setJoinAmt(e.target.value)}
            inputMode="decimal"
            className="field mt-1 text-lg tabular"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {(isGen0 ? ["0.08", "0.02", "0.05", "0.2"] : ["0.02", "0.05", "0.1", "0.2"]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setJoinAmt(v)}
                className="chip rounded-sm px-3 py-1 font-[family-name:var(--font-mono)] text-xs"
              >
                {v}
              </button>
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-[var(--dim)]">You receive</dt>
              <dd className="font-[family-name:var(--font-mono)] tabular">
                {joinWei > 0n ? fmtEth(joinShares) : "—"} {token}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dim)]">Fee (creator + protocol)</dt>
              <dd className="font-[family-name:var(--font-mono)] tabular">
                {joinWei > 0n ? fmtEth(joinFee) : "—"}
              </dd>
            </div>
          </dl>
          {joinTooSmall && (
            <p className="mt-2 text-sm text-[var(--gold)]">
              Minimum {onchainSupply === 0n ? "first deposit" : "join"} is {minJoin} ETH.
            </p>
          )}
          <button
            type="button"
            disabled={!live || !isConnected || wrongChain || busy || joinWei === 0n || joinTooSmall || paused}
            onClick={() => void onJoin()}
            className="ape mt-5 w-full rounded-sm px-4 py-3 text-sm disabled:opacity-40"
          >
            {!live ? "Vault not live" : busy ? "Confirm in wallet…" : `Join ${token}`}
          </button>
        </div>

        <div className="holo rounded-2xl p-4 sm:p-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl">Leave</h2>
          <p className="mt-1 text-[15px] leading-6 text-[var(--dim)]">
            Burn ${token}, receive ETH from the cash buffer. No token airdrop. Redeem fee is 0%.
          </p>
          <p className="mt-3 font-[family-name:var(--font-mono)] text-sm tabular text-[var(--dim)]">
            Your {token} {snap ? fmtEth(snap.userShares) : isConnected ? "…" : "connect to see"}
            {live && snap && snap.buffer > 0n ? ` · buffer ${fmtEth(snap.buffer)}` : ""}
          </p>
          <label className="mt-4 block font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-[var(--dim)]">
            {token} to burn
          </label>
          <input
            value={leaveAmt}
            onChange={(e) => setLeaveAmt(e.target.value)}
            inputMode="decimal"
            className="field mt-1 text-lg tabular"
          />
          {snap && snap.userShares > 0n && (
            <button
              type="button"
              onClick={() => setLeaveAmt(formatEther(snap.userShares))}
              className="mt-2 font-[family-name:var(--font-mono)] text-xs underline"
            >
              Max
            </button>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-[var(--dim)]">You receive</dt>
              <dd className="font-[family-name:var(--font-mono)] tabular">
                {leaveNet != null ? fmtEth(leaveNet) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dim)]">Buffer</dt>
              <dd className="font-[family-name:var(--font-mono)] tabular">
                {leaveWei > 0n && canLeave === false ? "too thin" : "ETH, not dust"}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            disabled={
              !live || !isConnected || wrongChain || busy || leaveWei === 0n || paused || canLeave === false
            }
            onClick={() => void onLeave()}
            className="ghost mt-5 w-full rounded-sm px-4 py-3 disabled:opacity-40"
          >
            {!live ? "Vault not live" : busy ? "Confirm in wallet…" : "Redeem to ETH"}
          </button>
        </div>
      </section>

      {txHash && (
        <p className="mt-4 font-[family-name:var(--font-mono)] text-sm">
          {confirmed ? "Confirmed · " : "Pending · "}
          <a className="underline" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
            {shortAddr(txHash)}
          </a>
        </p>
      )}
      {txErr && <p className="mt-3 text-sm text-[var(--danger)]">{txErr}</p>}

      {book && (
        <section className="mt-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-[family-name:var(--font-display)] text-3xl">Holdings</h2>
            <p className="max-w-md text-sm text-[var(--dim)]">
              Names under {fmtUsd(MIN_SLEEVE_USD, 0)} park in WETH until NAV grows.
              {isGen0 && (
                <>
                  {" "}
                  <a className="underline" href={TWEET} target="_blank" rel="noreferrer">
                    696_eth list
                  </a>
                </>
              )}
            </p>
          </div>
          <div className="holo mt-4 overflow-x-auto rounded-xl">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wider text-[var(--dim)]">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Weight</th>
                  <th className="px-4 py-3 text-right">Sleeve</th>
                </tr>
              </thead>
              <tbody>
                {book.active.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--line)]">
                    <td className="px-4 py-2.5 font-medium">{s.symbol || s.id}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-sm border border-[var(--line)] px-2 py-0.5 text-[12px] text-[var(--paper)]">
                        Held
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-[family-name:var(--font-mono)] tabular">
                      {(s.weight * 100).toFixed(2)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-[family-name:var(--font-mono)] tabular">
                      {fmtUsd(s.usd)}
                    </td>
                  </tr>
                ))}
                {book.skipped.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--line)] bg-[var(--gold)]/5">
                    <td className="px-4 py-2.5 font-medium">{s.symbol || s.id}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-sm border border-[var(--gold)]/40 px-2 py-0.5 text-[12px] text-[var(--gold)]">
                        Floor → ETH
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-[family-name:var(--font-mono)] tabular text-[var(--dim)]">
                      {(s.policyWeight * 100).toFixed(2)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-[family-name:var(--font-mono)] tabular text-[var(--dim)]">
                      {fmtUsd(s.policyUsd)}
                    </td>
                  </tr>
                ))}
                {dead.map((s) => (
                  <tr key={s.id} className="border-t border-[var(--line)] opacity-50">
                    <td className="px-4 py-2.5">{s.id}</td>
                    <td className="px-4 py-2.5 text-[12px] uppercase tracking-wide">
                      {s.reason.replace("_", " ")}
                    </td>
                    <td className="px-4 py-2.5 text-right">—</td>
                    <td className="px-4 py-2.5 text-right">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="mt-16 border-t border-[var(--line)] pt-6 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-[var(--dim)]">
        HOODX · Robinhood Chain 4663. Not HOOD10. Not financial advice. DYOR.
        {live && vault && (
          <>
            {" "}
            <a className="underline" href={`${EXPLORER}/address/${vault}`} target="_blank" rel="noreferrer">
              Vault {shortAddr(vault)}
            </a>
          </>
        )}
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="holo rounded-xl px-3 py-3 sm:px-4">
      <p className="text-[11px] leading-none text-[var(--dim)]">{label}</p>
      <p className="mt-1.5 font-[family-name:var(--font-display)] text-xl leading-none sm:text-2xl">{value}</p>
      <p className="mt-1.5 text-xs leading-5 text-[var(--dim)]">{hint}</p>
    </div>
  );
}
