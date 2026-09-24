import { getAddress, isAddress, parseAbi, type Address } from "viem";

const configuredFactory = (process.env.NEXT_PUBLIC_ATOMIC_FACTORY_ADDRESS || "").trim();

export const atomicFactoryAddress: Address | undefined = isAddress(configuredFactory)
  ? getAddress(configuredFactory)
  : undefined;

export const atomicFactoryStartBlock = (() => {
  try {
    return BigInt(process.env.NEXT_PUBLIC_ATOMIC_FACTORY_START_BLOCK || "0");
  } catch {
    return 0n;
  }
})();

export const atomicFactoryAbi = parseAbi([
  "function bySlug(string) view returns (address)",
  "function implementation() view returns (address)",
  "function configIdByToken(address) view returns (bytes32)",
  "function createAtomic(string slug,(address curator,address creator,address recipient,address treasury,string name,string symbol,uint16 creatorFee,uint16 protocolFee,uint16 cashBps,uint256 firstDeposit,string imageURI) p,bytes32[] configs,uint16[] weights) returns (address vault,address controller)",
]);
