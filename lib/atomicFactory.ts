import { parseAbi, type Address } from "viem";

export const productionAtomicFactoryAddress: Address = "0x29349c79863b58e7ab470865f7c6df0b31dc7c17";
export const atomicFactoryAddress: Address = productionAtomicFactoryAddress;
export const atomicFactoryStartBlock = 71893730n;

export const atomicFactoryAbi = parseAbi([
  "function bySlug(string) view returns (address)",
  "function implementation() view returns (address)",
  "function configIdByToken(address) view returns (bytes32)",
  "function createAtomic(string slug,(address curator,address creator,address recipient,address treasury,string name,string symbol,uint16 creatorFee,uint16 protocolFee,uint16 cashBps,uint256 firstDeposit,string imageURI) p,bytes32[] configs,uint16[] weights) returns (address vault,address controller)",
]);
