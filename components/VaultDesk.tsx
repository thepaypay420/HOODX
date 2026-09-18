"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, parseEther, zeroAddress, type Address } from "viem";
import { erc20Abi, vaultAbi } from "@/lib/abi";
import { byAddress } from "@/lib/catalog";
import { robinhood } from "@/lib/chain";
import {
  CASH_TARGET,
  CREATOR_FEE_BPS,
  EXPLORER,
  ISSUE_FEE_BPS,
  MIN_CREATE_FIRST_ETH,
  MIN_DEPOSIT_ETH,
  MIN_FIRST_ETH,
  MIN_SLEEVE_USD,
  PROTOCOL_FEE_BPS,
  TWEET,
  USD_PER_SHARE,
  WETH,
  isLive696x,
} from "@/lib/config";
import { fmtEth, fmtPct, fmtShares, fmtUsd, formatEtherSafe, isAddress, pctDelta, shortAddr, toneOf } from "@/lib/format";
import { publicClient, useWallet } from "@/lib/wallet";
import { activeBook, issueSplit, type Sleeve } from "@/lib/weights";
import { hydrateVaultCoins, formatTargetPct } from "@/lib/vaultCoins";
import { sleeveWethWei } from "@/lib/sleeveValue";
import { TokenArt } from "@/components/TokenArt";
import { BLURB_EVENT, readBlurb } from "@/lib/blurbs";
import snapshot from "../public/sleeves.json";

type Bag = { token: Address; symbol: string; wei: bigint; wethWei: bigint; targetBps: number };

type VaultSnap = {
  assets: bigint;
  supply: bigint;
  buffer: bigint;
  paused: boolean;
  feeBps: number;
  creatorBps: number;
  protocolBps: number;
  userShares: bigint;
  userValue: bigint;
  userCost: bigint;
  sharePrice: bigint;
  genesis: bigint;
  symbol: string;
  minFirst: number;
  shortfall: bigint;
  listed: Address[];
  bags: Bag[];
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
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [joinAmt, setJoinAmt] = useState(isGen0 ? "0.08" : "0.02");
  const [leaveAmt, setLeaveAmt] = useState("");
  const [snap, setSnap] = useState<VaultSnap | null>(null);
  const [onchainJoin, setOnchainJoin] = useState<{ shares: bigint; fee: bigint } | null>(null);
  const [joinPlan, setJoinPlan] = useState<{ spent: bigint; kept: bigint; names: number } | null>(null);
  const [leaveNet, setLeaveNet] = useState<bigint | null>(null);
  const [leaveMin, setLeaveMin] = useState<{ minOut: bigint; names: number } | null>(null);
  const [canLeave, setCanLeave] = useState<boolean | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [txErr, setTxErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [restoreToken, setRestoreToken] = useState("");
  const [restoreAmt, setRestoreAmt] = useState("");
  const [blurb, setBlurb] = useState(() => readBlurb(slug, vaultProp));

  const { address, chainId, walletClient, connect, connecting, switchToRobinhood } = useWallet();
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

  useEffect(() => {
    const sync = () => setBlurb(readBlurb(slug, vaultProp));
    sync();
    window.addEventListener(BLURB_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BLURB_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [slug, vaultProp]);

  const loadVault = useCallback(async () => {
    if (!vault) {
      setSnap(null);
      return;
    }
    const [assets, supply, buffer, paused, feeBps, creatorBps, protocolBps, symbol, minFirstWei, shortfall, listed, genesis] =
      await Promise.all([
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalAssets" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "totalSupply" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "wethBuffer" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "paused" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "issueFeeBps" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "creatorFeeBps" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "protocolFeeBps" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "symbol" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "minFirstDeposit" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "cashShortfall" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "constituents" }),
      publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "genesisEthPerShare" }),
    ]);
    let price = supply > 0n && assets > 0n ? (assets * 10n ** 18n) / supply : 0n;
    try {
      price = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "sharePrice" });
    } catch {
      /* pre-sharePrice impl: derive from NAV when supply > 0; never assume 1 ETH/share */
    }
    let userShares = 0n;
    let userValue = 0n;
    let userCost = 0n;
    if (address) {
      try {
        const pos = await publicClient.readContract({
          address: vault,
          abi: vaultAbi,
          functionName: "position",
          args: [address],
        });
        userShares = pos[0];
        userValue = pos[1];
        userCost = pos[2];
      } catch {
        userShares = await publicClient.readContract({
          address: vault,
          abi: vaultAbi,
          functionName: "balanceOf",
          args: [address],
        });
        userValue = supply === 0n || userShares === 0n ? 0n : (userShares * assets) / supply;
      }
    }
    const listedAddrs = listed as Address[];
    await hydrateVaultCoins(vault, listedAddrs.map((a) => a.toLowerCase()));
    const bagAddrs = [WETH as Address, ...listedAddrs];
    const bags: Bag[] = [];
    try {
      const bals = await Promise.all(
        bagAddrs.map((token) =>
          publicClient.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [vault],
          }),
        ),
      );
      const targets = await Promise.all(
        listedAddrs.map((token) =>
          publicClient.readContract({
            address: vault,
            abi: vaultAbi,
            functionName: "targetBps",
            args: [token],
          }),
        ),
      );
      const wethVals = await Promise.all(bagAddrs.map((token, i) => sleeveWethWei(vault, token, bals[i])));
      bagAddrs.forEach((token, i) => {
        const coin = byAddress(token);
        const isWeth = token.toLowerCase() === WETH.toLowerCase();
        const listedIdx = listedAddrs.findIndex((t) => t.toLowerCase() === token.toLowerCase());
        bags.push({
          token,
          symbol: coin?.symbol || (isWeth ? "WETH" : shortAddr(token)),
          wei: bals[i],
          wethWei: wethVals[i],
          targetBps: listedIdx >= 0 ? Number(targets[listedIdx]) : 0,
        });
      });
    } catch {
      /* explorer link still works if a sleeve balance fails */
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
      userValue,
      userCost,
      sharePrice: price,
      genesis,
      symbol,
      minFirst: Number(formatEther(minFirstWei)),
      shortfall,
      listed: listed as Address[],
      bags,
    });
    if (!restoreToken && listed.length) setRestoreToken(listed[0]);
  }, [vault, address]);

  useEffect(() => {
    void loadVault().catch(() => setSnap(null));
  }, [loadVault]);

  const navEth = snap && snap.assets > 0n ? Number(formatEther(snap.assets)) : 0;
  const displayNavUsd =
    navEth > 0 && ethUsd && ethUsd > 0 ? navEth * ethUsd : isGen0 && navEth === 0 ? 200 : 0;
  const liveCash =
    snap && snap.assets > 0n ? Number(snap.buffer) / Number(snap.assets) : null;
  const sharePxEth = snap && snap.sharePrice > 0n ? Number(formatEtherSafe(snap.sharePrice)) : 0;
  const userRoi = snap ? pctDelta(snap.userValue, snap.userCost) : null;
  const vaultRoi = snap ? pctDelta(snap.sharePrice, snap.genesis) : null;
  const book = useMemo(
    () => (sleeves.length ? activeBook(sleeves, displayNavUsd || 200, MIN_SLEEVE_USD, CASH_TARGET) : null),
    [sleeves, displayNavUsd],
  );
  const legacyIds = useMemo(() => new Set(dead.map((d) => d.id.toUpperCase())), [dead]);
  const policyByTok = useMemo(() => {
    const m = new Map<string, Sleeve>();
    for (const s of sleeves) {
      if (s.token) m.set(s.token.toLowerCase(), s);
    }
    return m;
  }, [sleeves]);
  const liveRows = useMemo(() => {
    if (!live || !snap) return null;
    const nav = snap.assets;
    const rows = snap.bags.map((b) => {
      const cash = b.token.toLowerCase() === WETH.toLowerCase();
      const policy = policyByTok.get(b.token.toLowerCase());
      const eth = Number(formatEtherSafe(b.wethWei));
      const usd = ethUsd && ethUsd > 0 ? eth * ethUsd : 0;
      const liveW = nav > 0n ? Number(b.wethWei) / Number(nav) : 0;
      const status: "held" | "missed" | "cash" = cash ? "cash" : b.wei > 0n ? "held" : "missed";
      const coin = byAddress(b.token);
      const legacy =
        !cash &&
        Boolean(
          coin &&
            (legacyIds.has(coin.id.toUpperCase()) || legacyIds.has((coin.symbol || "").toUpperCase())),
        );
      return {
        key: b.token,
        name: b.symbol,
        status,
        liveW,
        listW: policy?.weight ?? 0,
        targetBps: b.targetBps,
        legacy,
        targetLabel: formatTargetPct(b.targetBps, policy?.weight ?? 0, {
          cash,
          held: status === "held",
          liveWeight: liveW,
          legacy,
        }),
        usd,
        bag: cash ? `${Number(formatEtherSafe(b.wei)).toFixed(4)} WETH` : `${Number(formatEtherSafe(b.wei)).toFixed(4)}`,
      };
    });
    rows.sort((a, b) => {
      const rank = (s: string) => (s === "held" ? 0 : s === "missed" ? 1 : 2);
      const d = rank(a.status) - rank(b.status);
      if (d) return d;
      return b.usd - a.usd;
    });
    return rows;
  }, [live, snap, policyByTok, ethUsd, legacyIds]);
  const heldBags = useMemo(() => {
    if (!snap) return [];
    return snap.bags
      .filter((b) => b.wei > 0n)
      .slice()
      .sort((a, b) => {
        const ac = a.token.toLowerCase() === WETH.toLowerCase() ? 1 : 0;
        const bc = b.token.toLowerCase() === WETH.toLowerCase() ? 1 : 0;
        if (ac !== bc) return ac - bc;
        return Number(b.wethWei - a.wethWei);
      });
  }, [snap]);

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
  const minFirst = snap?.minFirst ?? (isGen0 ? MIN_FIRST_ETH : MIN_CREATE_FIRST_ETH);
  const usdHint = ethUsd && ethUsd > 0;
  const localJoin = issueSplit(joinWei, BigInt(feeBps));
  const localShares =
    snap && snap.sharePrice > 0n ? (localJoin.net * 10n ** 18n) / snap.sharePrice : 0n;
  const joinShares = onchainJoin?.shares ?? localShares;

  useEffect(() => {
    if (!vault || joinWei === 0n) {
      setOnchainJoin(null);
      setJoinPlan(null);
      return;
    }
    publicClient
      .readContract({ address: vault, abi: vaultAbi, functionName: "previewDeposit", args: [joinWei] })
      .then((out) => setOnchainJoin({ shares: out[0], fee: out[1] }))
      .catch(() => setOnchainJoin(null));
    publicClient
      .readContract({ address: vault, abi: vaultAbi, functionName: "previewBuy", args: [joinWei] })
      .then((out) => setJoinPlan({ spent: out[0], kept: out[1], names: Number(out[2]) }))
      .catch(() => setJoinPlan(null));
  }, [vault, joinWei]);

  useEffect(() => {
    if (!vault || leaveWei === 0n) {
      setLeaveNet(null);
      setLeaveMin(null);
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
        functionName: "previewSell",
        args: [leaveWei],
      }),
      publicClient.readContract({
        address: vault,
        abi: vaultAbi,
        functionName: "canWithdraw",
        args: [leaveWei],
      }),
    ])
      .then(([preview, sell, ok]) => {
        setLeaveNet(preview[0]);
        setLeaveMin({ minOut: sell[0], names: Number(sell[1]) });
        setCanLeave(ok);
      })
      .catch(() => {
        setLeaveNet(null);
        setLeaveMin(null);
        setCanLeave(null);
      });
  }, [vault, leaveWei]);

  async function onJoin() {
    if (!vault || !walletClient || !address) return;
    setBusy(true);
    setTxErr(null);
    setConfirmed(false);
    try {
      const minShares = joinShares > 0n ? (joinShares * 9700n) / 10000n : 1n;
      const floor = minShares < 1n ? 1n : minShares;
      const gas = await publicClient.estimateContractGas({
        account: address,
        address: vault,
        abi: vaultAbi,
        functionName: "deposit",
        args: [floor],
        value: joinWei,
      });
      const hash = await walletClient.writeContract({
        account: address,
        address: vault,
        abi: vaultAbi,
        functionName: "deposit",
        args: [floor],
        value: joinWei,
        gas: (gas * 13n) / 10n,
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

  async function onRestore() {
    if (!vault || !walletClient || !address) return;
    const amt = (() => {
      try {
        return parseEther(restoreAmt || "0");
      } catch {
        return 0n;
      }
    })();
    if (amt === 0n || !isAddress(restoreToken)) return;
    setBusy(true);
    setTxErr(null);
    setConfirmed(false);
    try {
      const hash = await walletClient.writeContract({
        account: address,
        address: vault,
        abi: vaultAbi,
        functionName: "restoreCash",
        args: [restoreToken as Address, amt],
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
      const gas = await publicClient.estimateContractGas({
        account: address,
        address: vault,
        abi: vaultAbi,
        functionName: "withdraw",
        args: [leaveWei, leaveMin?.minOut ?? 0n],
      });
      const hash = await walletClient.writeContract({
        account: address,
        address: vault,
        abi: vaultAbi,
        functionName: "withdraw",
        args: [leaveWei, leaveMin?.minOut ?? 0n],
        gas: (gas * 13n) / 10n,
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 sm:flex-1 sm:items-start sm:gap-5">
          <TokenArt slug={slug} size="md" priority={isGen0} />
          <div className="min-w-0 shrink-0">
            <p className="text-[13px] text-[var(--dim)]">{isGen0 ? "Index" : `/${slug}`}</p>
            <h1 className="mt-0.5 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">${token}</h1>
          </div>
          {blurb ? (
            <div className="hidden min-w-0 flex-1 sm:block sm:pt-[1.55rem]">
              <VaultBlurb text={blurb} />
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {live && vault && (
            <a
              data-testid="vault-link"
              href={`${EXPLORER}/address/${vault}`}
              target="_blank"
              rel="noreferrer"
              className="ghost h-10 px-3 text-[12px] sm:px-4"
            >
              Vault
            </a>
          )}
          <button type="button" onClick={share} className="ghost h-10 px-3 text-[12px] sm:px-4">
            {copied ? "Copied" : "Share"}
          </button>
        </div>
      </div>
      {blurb ? (
        <div className="mt-3 sm:hidden">
          <VaultBlurb text={blurb} />
        </div>
      ) : null}

      <section data-testid="vault-board" className="holo desk mt-6 overflow-hidden sm:mt-8">
        <div className="desk-line grid grid-cols-2 gap-px">
          <HeroStat
            label="You"
            value={
              !isConnected
                ? "—"
                : snap && snap.userShares > 0n && usdHint
                  ? fmtUsd(Number(formatEtherSafe(snap.userValue)) * ethUsd, 0)
                  : snap && snap.userShares > 0n
                    ? fmtEth(snap.userValue, 3)
                    : "—"
            }
            hint={
              !isConnected
                ? "Connect to see your bag"
                : snap && snap.userShares > 0n
                  ? `${fmtShares(snap.userShares, token, 3)} · in ${fmtEth(snap.userCost, 3)}`
                  : "No shares yet"
            }
            tone="flat"
            testId="board-you"
          />
          <HeroStat
            label="Your ROI"
            value={!isConnected ? "—" : userRoi == null ? "—" : fmtPct(userRoi, 2)}
            hint={
              !isConnected
                ? "Connect"
                : snap && snap.userShares > 0n
                  ? `${fmtEth(snap.userValue, 4)} now`
                  : "Join to start a cost basis"
            }
            tone={!isConnected || userRoi == null ? "flat" : toneOf(userRoi)}
            testId="board-roi"
          />
          <HeroStat
            label="Vault"
            value={
              !live || !snap || snap.genesis === 0n ? "—" : vaultRoi == null ? "—" : fmtPct(vaultRoi, 2)
            }
            hint={
              snap && snap.genesis > 0n
                ? usdHint
                  ? `${fmtUsd(USD_PER_SHARE, 0)} → ${fmtUsd(sharePxEth * ethUsd, 2)} / share`
                  : `${fmtEth(snap.genesis, 4)} → ${fmtEth(snap.sharePrice, 4)}`
                : "Genesis not set"
            }
            tone={vaultRoi == null ? "flat" : toneOf(vaultRoi)}
            testId="board-vault"
          />
          <HeroStat
            label="NAV"
            value={displayNavUsd ? fmtUsd(displayNavUsd, 0) : "—"}
            hint={live && snap && snap.assets > 0n ? fmtEth(snap.assets, 4) : isGen0 ? "Plan $200" : "Not live"}
            tone="flat"
          />
        </div>
        <div className="desk-line grid grid-cols-3 gap-px">
          <Stat
            label="Share"
            value={
              onchainSupply === 0n
                ? fmtUsd(USD_PER_SHARE, 0)
                : usdHint
                  ? fmtUsd(sharePxEth * ethUsd, 2)
                  : sharePxEth
                    ? `${sharePxEth.toFixed(4)} ETH`
                    : "—"
            }
            hint={
              onchainSupply === 0n
                ? `First mint ${minFirst} ETH`
                : `${sharePxEth.toFixed(4)} ETH`
            }
          />
          <Stat
            label="Cash"
            value={
              liveCash != null ? `${(liveCash * 100).toFixed(0)}%` : book ? `${(book.cashWeight * 100).toFixed(0)}%` : "—"
            }
            hint={live && snap && snap.buffer > 0n ? fmtEth(snap.buffer, 3) : "ETH for exits"}
          />
          <Stat
            label="Fee"
            value={`${(feeBps / 100).toFixed(2)}%`}
            hint={`You ${(creatorBps / 100).toFixed(2)}% · HOODX ${(protocolBps / 100).toFixed(2)}%`}
          />
        </div>
        {live && snap && heldBags.length > 0 && (
          <div className="desk-bags px-4 py-4 sm:px-6 sm:py-5">
            <p className="mb-3 text-[13px] text-[var(--dim)]">In the vault</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {heldBags.map((b) => {
                const cash = b.token.toLowerCase() === WETH.toLowerCase();
                const eth = Number(formatEtherSafe(b.wethWei));
                const usd = ethUsd && ethUsd > 0 && eth > 0 ? eth * ethUsd : 0;
                const pct = snap.assets > 0n ? Number(b.wethWei) / Number(snap.assets) : 0;
                return (
                  <div
                    key={b.token}
                    className="desk-bag px-3 py-3 sm:px-4 sm:py-3.5"
                  >
                    <p className="truncate text-[13px] text-[var(--dim)]">{cash ? "Cash" : b.symbol}</p>
                    <p className="mt-1 text-[1.35rem] font-semibold leading-none tracking-[-0.04em] tabular sm:text-2xl">
                      {usd > 0
                        ? fmtUsd(usd, 0)
                        : Number(formatEtherSafe(b.wei)).toFixed(cash ? 3 : 2)}
                    </p>
                    <p className="mt-1.5 text-[12px] tabular text-[var(--dim)]">
                      {pct > 0 ? `${(pct * 100).toFixed(1)}%` : cash ? b.symbol : "—"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {!live && (
        <p className="holo mt-5 px-4 py-3 text-sm text-[var(--dim)]">
          {isGen0 ? "Vault address not set." : "Unknown slug. Create one below."}
        </p>
      )}
      {paused && (
        <p className="mt-5 rounded-[20px] border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-3 text-sm text-[var(--gold)]">
          Joins closed. Redeem stays open.
        </p>
      )}

      <section className="holo mt-6 overflow-hidden p-1 sm:mt-8">
        <div className="grid gap-1 lg:grid-cols-2 lg:items-stretch">
        <div className="flex h-full flex-col rounded-[16px] bg-[var(--lift)] p-4 sm:p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] font-medium text-[var(--dim)]">Join</h2>
            <p className="text-[12px] text-[var(--dim)]">
              {onchainSupply === 0n ? `First ${minFirst} ETH` : `${(feeBps / 100).toFixed(2)}% fee`}
            </p>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <input
              data-testid="vault-join-amt"
              value={joinAmt}
              onChange={(e) => setJoinAmt(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="swap-amt min-w-0"
            />
            <span className="token-pill">ETH</span>
          </div>
          <p className="mt-1 text-[13px] tabular text-[var(--dim)]">
            {usdHint && Number(joinAmt) > 0 ? fmtUsd(Number(joinAmt) * (ethUsd as number), 0) : "\u00a0"}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(isGen0 ? ["0.08", "0.02", "0.05", "0.2"] : ["0.02", "0.05", "0.1", "0.2"]).map((v) => (
              <button
                key={v}
                type="button"
                data-testid={`vault-join-chip-${v}`}
                onClick={() => setJoinAmt(v)}
                className={`chip px-3 text-[12px] ${joinAmt === v ? "on" : ""}`}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <p className="text-[var(--dim)]">You get</p>
              <p className="mt-0.5 font-medium tabular">
                {joinWei > 0n && joinShares > 0n
                  ? `~${Number(formatEther(joinShares)).toFixed(3)} ${token}`
                  : "—"}
                {joinPlan ? ` · ${joinPlan.names} names` : ""}
              </p>
            </div>
            <div>
              <p className="text-[var(--dim)]">Share</p>
              <p className="mt-0.5 font-medium tabular">
                {onchainSupply === 0n
                  ? fmtUsd(USD_PER_SHARE, 0)
                  : usdHint
                    ? fmtUsd(sharePxEth * ethUsd, 2)
                    : `${sharePxEth.toFixed(4)} ETH`}
              </p>
            </div>
          </div>
          {joinTooSmall && <p className="mt-2 text-[13px] text-[var(--gold)]">Min {minJoin} ETH.</p>}
          <div className="mt-auto w-full pt-4">
          <button
            type="button"
            data-testid="vault-join"
            disabled={
              !live ||
              busy ||
              paused ||
              (isConnected && !wrongChain && (joinWei === 0n || joinTooSmall))
            }
            onClick={() => {
              if (!address) {
                void connect();
                return;
              }
              if (wrongChain) {
                void switchToRobinhood();
                return;
              }
              void onJoin();
            }}
            className="ape w-full text-[15px] disabled:opacity-40"
          >
            {!live
              ? "Not live"
              : busy
                ? "Confirm…"
                : !isConnected
                  ? connecting
                    ? "Connecting…"
                    : "Connect"
                  : wrongChain
                    ? "Switch network"
                    : `Join ${token}`}
          </button>
          </div>
        </div>

        <div className="flex h-full flex-col rounded-[16px] bg-[var(--lift)] p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-medium text-[var(--dim)]">Leave</h2>
            <p data-testid="vault-shares" className="truncate text-[12px] tabular text-[var(--dim)]">
              {!isConnected ? "—" : snap ? fmtShares(snap.userShares, token, 3) : "…"}
            </p>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <input
              data-testid="vault-leave-amt"
              value={leaveAmt}
              onChange={(e) => setLeaveAmt(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="swap-amt min-w-0"
            />
            <span className="token-pill">{token}</span>
          </div>
          <div className="mt-1 flex min-h-[1.25rem] items-center justify-end">
            {snap && snap.userShares > 0n && (
              <button
                type="button"
                data-testid="vault-leave-max"
                onClick={() => setLeaveAmt(formatEther(snap.userShares))}
                className="text-[12px] font-medium text-[var(--cyan)]"
              >
                Max
              </button>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <p className="text-[var(--dim)]">Est. ETH</p>
              <p className="mt-0.5 font-medium tabular">{leaveNet != null ? fmtEth(leaveNet, 4) : "—"}</p>
            </div>
            <div>
              <p className="text-[var(--dim)]">Min after 3%</p>
              <p className="mt-0.5 font-medium tabular">{leaveMin ? fmtEth(leaveMin.minOut, 4) : "—"}</p>
            </div>
          </div>
          <p className="mt-3 text-[12px] leading-5 text-[var(--dim)]">
            Redeem cannot be paused{isLive696x(vault) ? ". Live 696X exits stay open." : "."}
          </p>
          {canLeave === false && leaveWei > 0n && (
            <p className="mt-2 text-[13px] text-[var(--gold)]">Buffer short. Restore cash first.</p>
          )}
          <div className="mt-auto w-full pt-4">
          <button
            type="button"
            data-testid="vault-leave"
            disabled={
              !live ||
              busy ||
              (isConnected && !wrongChain && (leaveWei === 0n || canLeave === false))
            }
            onClick={() => {
              if (!address) {
                void connect();
                return;
              }
              if (wrongChain) {
                void switchToRobinhood();
                return;
              }
              void onLeave();
            }}
            className="ghost cta w-full disabled:opacity-40"
          >
            {!live
              ? "Not live"
              : busy
                ? "Confirm…"
                : !isConnected
                  ? connecting
                    ? "Connecting…"
                    : "Connect"
                  : wrongChain
                    ? "Switch network"
                    : "Redeem"}
          </button>
          </div>
        </div>
        </div>
      </section>

      {live && snap && snap.shortfall > 0n && (
        <section className="holo mt-4 p-4 sm:p-5">
          <h2 className="text-lg font-semibold tracking-[-0.03em]">Restore cash</h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--dim)]">
            Short {fmtEth(snap.shortfall, 4)}. Anyone can sell a name to WETH.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-[11px] text-[var(--dim)]">
              Name
              <select
                data-testid="vault-restore-token"
                value={restoreToken}
                onChange={(e) => setRestoreToken(e.target.value)}
                className="field mt-1 text-sm"
              >
                {snap.listed.map((t) => (
                  <option key={t} value={t}>
                    {shortAddr(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] text-[var(--dim)]">
              Token amount in
              <input
                data-testid="vault-restore-amt"
                value={restoreAmt}
                onChange={(e) => setRestoreAmt(e.target.value)}
                className="field mt-1"
                placeholder="0.0"
              />
            </label>
          </div>
          <button
            type="button"
            data-testid="vault-restore"
            disabled={!isConnected || wrongChain || busy || !restoreAmt}
            onClick={() => void onRestore()}
            className="ghost mt-4 w-full disabled:opacity-40"
          >
            {busy ? "Confirm…" : "Restore cash"}
          </button>
        </section>
      )}

      {txHash && (
        <p data-testid="vault-tx" className="mt-4 font-[family-name:var(--font-mono)] text-sm">
          {confirmed ? "Confirmed · " : "Pending · "}
          <a className="underline" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
            {shortAddr(txHash)}
          </a>
        </p>
      )}
      {txErr && (
        <p data-testid="vault-err" className="mt-3 text-sm text-[var(--danger)]">
          {txErr}
        </p>
      )}

      {(liveRows || book) && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold tracking-[-0.03em]">
            {liveRows ? "Holdings" : "Targets"}
          </h2>
          <p className="mt-1 max-w-lg text-[13px] leading-5 text-[var(--dim)]">
            {liveRows
              ? "Live is the vault TWAP sleeve. Target is on-chain, then the 696 book — legacy bags with no target show live weight and · park."
              : `Under ${fmtUsd(MIN_SLEEVE_USD, 0)} parks in WETH.`}
            {isGen0 && (
              <>
                {" "}
                <a className="text-[var(--paper)] underline-offset-2 hover:underline" href={TWEET} target="_blank" rel="noreferrer">
                  696 list
                </a>
              </>
            )}
          </p>
          <div className="holo mt-4 overflow-x-auto">
            <table data-testid="holdings-table" className="w-full text-left text-[13px]">
              <thead className="text-[12px] text-[var(--dim)]">
                <tr>
                  <th className="px-3 py-3 sm:px-4">Name</th>
                  <th className="px-3 py-3 sm:px-4">Status</th>
                  <th className="hidden px-3 py-3 text-right sm:table-cell sm:px-4">Bag</th>
                  <th className="px-3 py-3 text-right sm:px-4">{liveRows ? "Live" : "Weight"}</th>
                  {liveRows ? <th className="hidden px-4 py-3 text-right sm:table-cell">Target</th> : null}
                  <th className="px-3 py-3 text-right sm:px-4">Sleeve</th>
                </tr>
              </thead>
              <tbody>
                {liveRows
                  ? liveRows.map((r) => (
                      <tr
                        key={r.key}
                        className={`border-t border-[var(--line)] ${r.status === "missed" ? "bg-[var(--gold)]/5" : ""}`}
                      >
                        <td className="px-4 py-2.5 font-medium">{r.name}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[12px] ${
                              r.status === "missed"
                                ? "border-[var(--gold)]/40 text-[var(--gold)]"
                                : "border-[var(--line)] text-[var(--paper)]"
                            }`}
                          >
                            {r.status === "cash" ? "Cash" : r.status === "missed" ? "Missed" : "Held"}
                          </span>
                        </td>
                        <td className="hidden px-4 py-2.5 text-right font-[family-name:var(--font-mono)] tabular text-[var(--dim)] sm:table-cell">
                          {r.status === "missed" ? "—" : r.bag}
                        </td>
                        <td className="px-4 py-2.5 text-right font-[family-name:var(--font-mono)] tabular">
                          {(r.liveW * 100).toFixed(2)}%
                        </td>
                        <td className="hidden px-4 py-2.5 text-right font-[family-name:var(--font-mono)] tabular text-[var(--dim)] sm:table-cell">
                          <span
                            className={
                              r.targetLabel.includes("park") || r.targetLabel === "unset" ? "text-[var(--gold)]" : ""
                            }
                          >
                            {r.targetLabel}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-[family-name:var(--font-mono)] tabular">
                          {r.usd > 0 ? fmtUsd(r.usd) : "—"}
                        </td>
                      </tr>
                    ))
                  : book!.active.map((s) => (
                      <tr key={s.id} className="border-t border-[var(--line)]">
                        <td className="px-4 py-2.5 font-medium">{s.symbol || s.id}</td>
                        <td className="px-4 py-2.5">
                          <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[12px] text-[var(--paper)]">
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
                {!liveRows &&
                  book!.skipped.map((s) => (
                    <tr key={s.id} className="border-t border-[var(--line)] bg-[var(--gold)]/5">
                      <td className="px-4 py-2.5 font-medium">{s.symbol || s.id}</td>
                      <td className="px-4 py-2.5">
                        <span className="rounded-full border border-[var(--gold)]/40 px-2 py-0.5 text-[12px] text-[var(--gold)]">
                          Park in ETH
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
                {!liveRows &&
                  dead.map((s) => (
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

      <p className="mt-14 border-t border-[var(--line)] pt-5 text-[12px] leading-5 text-[var(--dim)]">
        HOODX · 4663 · DYOR.
        {live && vault && (
          <>
            {" "}
            <a className="underline-offset-2 hover:underline" href={`${EXPLORER}/address/${vault}`} target="_blank" rel="noreferrer">
              {shortAddr(vault)}
            </a>
          </>
        )}
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="desk-cell px-2.5 py-4 sm:px-5 sm:py-5">
      <p className="text-[12px] text-[var(--dim)]">{label}</p>
      <p className="mt-1.5 text-[1.35rem] font-semibold leading-none tracking-[-0.04em] tabular sm:text-2xl">{value}</p>
      <p className="mt-1.5 text-[12px] leading-5 text-[var(--dim)]">{hint}</p>
    </div>
  );
}

function HeroStat({
  label,
  value,
  hint,
  tone,
  testId,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "up" | "down" | "flat";
  testId?: string;
}) {
  const color = tone === "up" ? "tone-up" : tone === "down" ? "tone-down" : "tone-flat";
  return (
    <div data-testid={testId} className="desk-cell px-4 py-5 sm:px-6 sm:py-6">
      <p className="text-[12px] text-[var(--dim)]">{label}</p>
      <p className={`mt-2 text-[1.85rem] font-semibold leading-none tracking-[-0.05em] tabular sm:text-4xl ${color}`}>
        {value}
      </p>
      <p className="mt-2 text-[12px] leading-5 text-[var(--dim)]">{hint}</p>
    </div>
  );
}

function VaultBlurb({ text }: { text: string }) {
  const parts = text.split(/(@[A-Za-z0-9_]+)/g);
  return (
    <p className="vault-blurb" data-testid="vault-blurb">
      {parts.map((part, i) =>
        part.startsWith("@") ? (
          <a key={`${part}-${i}`} href={`https://x.com/${part.slice(1)}`} target="_blank" rel="noreferrer">
            {part}
          </a>
        ) : (
          <span key={`${part}-${i}`}>{part}</span>
        ),
      )}
    </p>
  );
}
