import { createPublicClient, createWalletClient, formatEther, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";
import { planKeeperRun, readyRebands, type SleeveStatus } from "@/lib/autolpKeeper";
import { AUTO_LP, stockLpControllerAbi, stockLpSleeveAbi } from "@/lib/stockLp";

// Hourly Vercel Cron: the Automated LP "autopilot" keeper. Every action is a permissionless, rule-bound crank on
// HoodxStockLpControllerV2 (the contracts decide whether it is allowed and how much to move), so the keeper key
// only pays gas and cannot move vault funds. Each transaction is simulated first and skipped if it would revert.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Step = { action: string; ok: boolean; tx?: Hex; note?: string };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const controller = AUTO_LP.controller;
  if (!controller) return Response.json({ status: "not-live" });
  const key = process.env.AUTOLP_KEEPER_PRIVATE_KEY as Hex | undefined;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return Response.json({ error: "keeper key not configured" }, { status: 503 });

  const transport = http(process.env.ROBINHOOD_RPC_URL || RPC_URL, { timeout: 20_000, retryCount: 1 });
  const account = privateKeyToAccount(key);
  const pub = createPublicClient({ chain: robinhood, transport });
  const wallet = createWalletClient({ account, chain: robinhood, transport });
  if ((await pub.getChainId()) !== robinhood.id) return Response.json({ error: "wrong chain" }, { status: 503 });

  const steps: Step[] = [];
  const run = async (action: string, req: Parameters<typeof pub.simulateContract>[0]) => {
    try {
      const sim = await pub.simulateContract({ ...req, account });
      const tx = await wallet.writeContract(sim.request);
      const r = await pub.waitForTransactionReceipt({ hash: tx, timeout: 60_000 });
      steps.push({ action, ok: r.status === "success", tx });
      return r.status === "success";
    } catch (e) {
      steps.push({ action, ok: false, note: e instanceof Error ? e.message.split("\n")[0].slice(0, 160) : "skipped" });
      return false;
    }
  };
  const readStatuses = async (n: number): Promise<SleeveStatus[]> => Promise.all(Array.from({ length: n }, (_, i) =>
    pub.readContract({ address: controller, abi: stockLpControllerAbi, functionName: "status", args: [BigInt(i)] })
      .then(([inRange, referenceAgrees, breachStart, , rebandReady]) => ({ inRange, referenceAgrees, breachStart: BigInt(breachStart), rebandReady }))));

  const sleeves = (await pub.readContract({ address: controller, abi: stockLpControllerAbi, functionName: "sleeves" })) as readonly Address[];
  let statuses = await readStatuses(sleeves.length);
  const plan = planKeeperRun(statuses, new Date());

  if (plan.signal) {
    await run("signalAll", { address: controller, abi: stockLpControllerAbi, functionName: "signalAll" });
    statuses = await readStatuses(sleeves.length);
  }
  for (const i of readyRebands(statuses)) {
    await run(`executeReband(${i})`, { address: controller, abi: stockLpControllerAbi, functionName: "executeReband", args: [BigInt(i)] });
  }
  if (plan.compound) {
    for (let i = 0; i < sleeves.length; i++) {
      await run(`harvest(${i})`, { address: controller, abi: stockLpControllerAbi, functionName: "harvest", args: [BigInt(i)] });
      await run(`compound(${i})`, { address: controller, abi: stockLpControllerAbi, functionName: "compound", args: [BigInt(i)] });
    }
  }
  if (plan.claim) {
    for (const s of sleeves) {
      await run(`claimFees(${s.slice(0, 8)})`, { address: s, abi: stockLpSleeveAbi, functionName: "claimFees" });
    }
  }
  const gas = await pub.getBalance({ address: account.address });
  const summary = {
    keeper: account.address, gasEth: formatEther(gas), lowGas: gas < 2_000_000_000_000_000n,
    outOfRange: statuses.flatMap((s, i) => (s.inRange ? [] : [i])), plan, steps,
  };
  console.log("autolp-keeper", JSON.stringify(summary));
  return Response.json(summary);
}
