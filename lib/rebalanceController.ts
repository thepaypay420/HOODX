import { parseAbi, type Address, type PublicClient } from "viem";

export const rebalanceControllerAbi = parseAbi([
  "function vault() view returns (address)",
  "function curator() view returns (address)",
  "function setPaused(bool value)",
  "function setTargets(uint16 cashBps,uint16[] weights)",
  "function rebalance(address token,bool buy,uint256 amount,uint256 minOut,uint256 deadline)",
  "function addConstituent(bytes32 id)",
  "function removeConstituent(address token)",
  "function emergencyUnwind(address token,uint256 amount,uint256 minOut,uint256 deadline) returns (uint256)",
  "function atomicRebalance(uint16 cashBps,uint16[] weights,(address token,bool buy,uint256 amount,uint256 minOut)[] steps,bytes32 expectedConstituentsHash,uint256 minCashAfter,uint256 deadline)",
]);

export const rebalanceControllerV3Abi = parseAbi([
  "function vault() view returns (address)",
  "function curator() view returns (address)",
  "function setPaused(bool value)",
  "function setTargets(uint16 cashBps,uint16[] weights)",
  "function rebalance(address token,bool buy,uint256 amount,uint256 minOut,uint256 minCashAfter,uint256 nonce,uint256 deadline)",
  "function addConstituent(bytes32 id)",
  "function replaceConfig(bytes32 id)",
  "function removeConstituent(address token)",
  "function emergencyUnwind(address token,uint256 amount,uint256 minOut,uint256 deadline) returns (uint256)",
  "function atomicRebalance(uint16 cashBps,uint16[] weights,(address token,bool buy,uint256 amount,uint256 minOut)[] steps,bytes32 expectedConstituentsHash,uint256 expectedPlanNonce,uint256 minCashAfter,uint256 deadline)",
]);

export type VaultAuthority = { curator: Address; controller?: Address };

export async function resolveVaultAuthority(
  client: PublicClient,
  vault: Address,
  owner: Address,
  blockNumber?: bigint,
): Promise<VaultAuthority> {
  const code = await client.getBytecode({ address: owner, blockNumber }).catch(() => undefined);
  if (!code || code === "0x") return { curator: owner };
  try {
    const [controlledVault, curator] = await Promise.all([
      client.readContract({ address: owner, abi: rebalanceControllerAbi, functionName: "vault", blockNumber }),
      client.readContract({ address: owner, abi: rebalanceControllerAbi, functionName: "curator", blockNumber }),
    ]);
    if (controlledVault.toLowerCase() !== vault.toLowerCase()) return { curator: owner };
    return { curator, controller: owner };
  } catch {
    return { curator: owner };
  }
}
