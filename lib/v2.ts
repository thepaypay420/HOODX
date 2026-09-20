import { parseAbi, type Address } from "viem";

export const v2VaultAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function paused() view returns (bool)",
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

// Populate only from the verified production manifest after live canary gates pass.
// Empty by design: no inferred, simulated, canary, or historical addresses.
export const verifiedV2Vaults: Readonly<Record<string, Address>> = Object.freeze({});
export function productionV2Vault(slug: string): Address | undefined {
  return verifiedV2Vaults[slug.trim().toLowerCase()];
}
