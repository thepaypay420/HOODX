import {describe,it,expect} from 'vitest';
import {type PublicClient} from 'viem';
import {verifyProportionalRelease,proportional696Release,type ProportionalRelease} from './proportionalRelease';
const release:ProportionalRelease={vault:'0x0000000000000000000000000000000000000001',implementation:'0x0000000000000000000000000000000000000002',factory:'0x0000000000000000000000000000000000000003',slug:'696x',launchBlock:1n};
const code=`0x363d3d373d3d3d363d73${release.implementation.slice(2)}5af43d82803e903d91602b57fd5bf3`;
const client={getChainId:async()=>4663,getCode:async()=>code,readContract:async(p:{functionName:string})=>p.functionName==='bySlug'?release.vault:release.implementation};
describe('successor release isolation',()=>{
  it('does not enable an undeployed successor',()=>expect(proportional696Release).toBeNull());
  it('accepts only the pinned factory mapping and exact clone implementation',async()=>{
    await expect(verifyProportionalRelease(client as unknown as PublicClient,release)).resolves.toBeUndefined();
    await expect(verifyProportionalRelease({...client,getCode:async()=>`${code}00`} as unknown as PublicClient,release)).rejects.toThrow('identity');
    await expect(verifyProportionalRelease({...client,readContract:async()=>release.factory} as unknown as PublicClient,release)).rejects.toThrow('identity');
  });
  it('rejects another chain before reading contract identities',async()=>{
    await expect(verifyProportionalRelease({...client,getChainId:async()=>1} as unknown as PublicClient,release)).rejects.toThrow('network');
  });
});
