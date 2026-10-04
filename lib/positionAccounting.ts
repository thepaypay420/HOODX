import { parseAbiItem, zeroAddress, type Address } from "viem";
import { scanLogs } from "@/lib/logScan";
import { AUTO_LP } from "@/lib/stockLp";
import { AUTO_LP_LAUNCH } from "@/lib/autolpNav";
import { BOOST } from "@/lib/boost";

/* A wallet's cost basis in one HOODX vault, rebuilt from the vault's own events.
 *
 * Every share a wallet holds arrived by one of: a deposit (ETH in, recorded with its gross amount), the Auto LP launch seed
 * (shares minted at the launch price), or a transfer from another wallet (no price on chain). Every share that left went by
 * an ETH withdrawal (proceeds recorded), an exit in kind (tokens, no ETH figure) or a transfer out.
 *
 *  - "exact":   only deposits/seeds in and ETH withdrawals out. Return = (value now + ETH withdrawn - ETH deposited) / deposited.
 *  - "average": shares also moved by transfer or in-kind exit. The ETH paid per deposited share is applied to the shares held
 *               now, giving a cost for the current position; return = value now / that cost - 1.
 *  - "none":    nothing was ever deposited by this wallet (all shares came by transfer), so there is no cost to measure from. */

export type Kind = "v2" | "v3" | "autolp" | "boost";
export type Accounting = { mode: "exact" | "average" | "none"; depositedWei: string; withdrawnWei: string; basisWei: string | null; deposits: number; withdrawals: number; seeded: boolean };

const INDEX_START = 67_761_602n;
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const deposit = parseAbiItem("event Deposit(address indexed user, uint256 gross, uint256 shares, uint256 fee)");
const withdraw = parseAbiItem("event Withdraw(address indexed user, uint256 shares, uint256 ethOut)");
const lpDeposit = parseAbiItem("event DepositedEth(address indexed account, address indexed receiver, uint256 shares, uint256 ethUsed, uint256 usdgValue)");
const lpWithdraw = parseAbiItem("event WithdrawnEth(address indexed account, address indexed receiver, uint256 shares, uint256 ethOut)");
const lpSeed = parseAbiItem("event Bootstrapped(address indexed receiver, uint256 shares)");
const bxDeposit = parseAbiItem("event Deposited(address indexed account, address indexed receiver, uint256 ethIn, uint256 shares, uint256 navAddedUsdg)");
const bxWithdraw = parseAbiItem("event Withdrawn(address indexed account, address indexed receiver, uint256 shares, uint256 ethOut)");
const bxSeed = parseAbiItem("event Bootstrapped(address indexed receiver, uint256 shares, uint256 ethIn, uint256 navUsdg)");
const E18 = 10n ** 18n;
const LAUNCH_PRICE_WEI = BigInt(Math.round(AUTO_LP_LAUNCH.perShareEth * 1e18));                // ETH per Auto LP share at launch, 1e18-scaled

export async function accountFor(wallet: Address, vault: Address, kind: Kind, currentShares: bigint): Promise<Accounting> {
  const lp = kind === "autolp", bx = kind === "boost";
  const from = lp ? AUTO_LP.deployBlock : bx ? BOOST.deployBlock : INDEX_START;
  const [tin, tout, ins, outs, seeds] = await Promise.all([
    scanLogs(vault, transfer, { to: wallet }, from),
    scanLogs(vault, transfer, { from: wallet }, from),
    bx ? scanLogs(vault, bxDeposit, { receiver: wallet }, from) : lp ? scanLogs(vault, lpDeposit, { receiver: wallet }, from) : scanLogs(vault, deposit, { user: wallet }, from),
    bx ? scanLogs(vault, bxWithdraw, { account: wallet }, from) : lp ? scanLogs(vault, lpWithdraw, { account: wallet }, from) : scanLogs(vault, withdraw, { user: wallet }, from),
    bx ? scanLogs(vault, bxSeed, { receiver: wallet }, from) : lp ? scanLogs(vault, lpSeed, { receiver: wallet }, from) : Promise.resolve([]),
  ]);
  let dep = 0n, depShares = 0n, wd = 0n, wdShares = 0n;
  for (const l of ins) { const a = l.args as { gross?: bigint; ethUsed?: bigint; ethIn?: bigint; shares?: bigint }; dep += a.gross ?? a.ethUsed ?? a.ethIn ?? 0n; depShares += a.shares ?? 0n; }
  for (const l of outs) { const a = l.args as { ethOut?: bigint; shares?: bigint }; wd += a.ethOut ?? 0n; wdShares += a.shares ?? 0n; }
  // Auto LP seeds record only shares (valued at the launch price); Boosted ETH seeds record the ETH paid
  for (const l of seeds) { const a = l.args as { shares?: bigint; ethIn?: bigint }; const s = a.shares ?? 0n; dep += a.ethIn ?? (s * LAUNCH_PRICE_WEI) / E18; depShares += s; }
  const zero = zeroAddress.toLowerCase();
  const transferredIn = tin.some((l) => (l.args.from ?? "").toLowerCase() !== zero);
  const transferredOut = tout.some((l) => (l.args.to ?? "").toLowerCase() !== zero);
  const burned = tout.filter((l) => (l.args.to ?? "").toLowerCase() === zero).reduce((a, l) => a + (l.args.value ?? 0n), 0n);
  // an exit in kind burns shares without an ETH withdrawal; Auto LP withdrawals burn the account's shares, which the event records
  const inKind = burned > wdShares;
  const base = { depositedWei: String(dep), withdrawnWei: String(wd), deposits: ins.length + seeds.length, withdrawals: outs.length, seeded: seeds.length > 0 };
  if (dep === 0n || depShares === 0n) return { ...base, mode: "none", basisWei: null };
  if (!transferredIn && !transferredOut && !inKind && depShares - wdShares === currentShares) return { ...base, mode: "exact", basisWei: null };
  return { ...base, mode: "average", basisWei: String((dep * currentShares) / depShares) };
}
