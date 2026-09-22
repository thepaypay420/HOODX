import {parseAbi, type Address, type PublicClient} from 'viem';
export type ProportionalRelease = {vault: Address; implementation: Address; factory: Address; slug: string; launchBlock: bigint};
// Filled only after source verification, reviewed deployment and recovered live canaries.
// Keeping this separate preserves both existing V2 vault addresses and their UI.
export const proportional696Release: ProportionalRelease | null = null;
export async function verifyProportionalRelease(client: PublicClient, release: ProportionalRelease) {
  if (await client.getChainId() !== 4663) throw new Error('Wrong network');
  const abi=parseAbi(['function bySlug(string) view returns(address)','function implementation() view returns(address)']);
  const [code, vault, implementation] = await Promise.all([
    client.getCode({address:release.vault}),
    client.readContract({address:release.factory,abi,functionName:'bySlug',args:[release.slug]}),
    client.readContract({address:release.factory,abi,functionName:'implementation'}),
  ]);
  const clone=`0x363d3d373d3d3d363d73${release.implementation.slice(2)}5af43d82803e903d91602b57fd5bf3`.toLowerCase();
  if (vault.toLowerCase()!==release.vault.toLowerCase() || implementation.toLowerCase()!==release.implementation.toLowerCase() || code?.toLowerCase()!==clone) throw new Error('Vault deployment identity mismatch');
}
