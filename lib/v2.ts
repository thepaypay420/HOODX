import { parseAbi, type Address } from "viem";

export const v2VaultAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
  "function setPaused(bool value)",
  "function emergencyUnwind(address token,uint256 amount,uint256 minOut,uint256 deadline) returns (uint256)",
  "function constituents() view returns (address[])",
  "function weth() view returns (address)",
  "function claimable(address,address) view returns (uint256)",
  "function previewDeposit(uint256) view returns (uint256)",
  "function minFirstDeposit() view returns (uint256)",
  "function deposit(uint256 minShares,uint256 deadline) payable returns (uint256)",
  "function withdraw(uint256 shares,uint256 minEthOut,uint256 deadline) returns (uint256)",
  "function emergencyRedeemInKind(uint256 shares,address recipient)",
  "function claim(address token,address recipient)",
]);

// Production receipts and empty-state verification recorded in deployments/robinhood-4663-v2.json.
export const productionV2Factory: Address = "0x5e846680bf8d702072b65e1e403d07e5a5f98b90";
export const productionV2Treasury: Address = "0x134d468b0bcaea6df127916f951f7938c06a37c6";
export const v2FactoryAbi = parseAbi([
  "function bySlug(string) view returns (address)",
  "function all(uint256) view returns (address)",
  "function create(string slug,(address curator,address creator,address recipient,address treasury,string name,string symbol,uint16 creatorFee,uint16 protocolFee,uint16 cashBps,uint256 firstDeposit,string imageURI) p,bytes32[] configs,uint16[] weights) returns (address)",
]);
export const verifiedV2Vaults: Readonly<Record<string, Address>> = Object.freeze({
  "696x": "0x531832cd20d33ee974afee7ba5720b8f3f2c9292",
  "faangx": "0xcb40b8d79ff6f4c5db15bd8a9692b934b52cb0b0",
});
export function productionV2Vault(slug: string): Address | undefined {
  return verifiedV2Vaults[slug.trim().toLowerCase()];
}
