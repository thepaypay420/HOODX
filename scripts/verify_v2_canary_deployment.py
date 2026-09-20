"""Verify live deployment transactions against preserved reviewed simulation inputs."""
import argparse, json
from pathlib import Path
from inspect_v2_canary import rpc, ROOT, DEPLOYER

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--reviewed',required=True)
    p.add_argument('--live',required=True)
    p.add_argument('--output',required=True)
    a=p.parse_args()
    assert int(rpc('eth_chainId',[]),16)==4663, 'chain'
    reviewed=json.loads(Path(a.reviewed).read_text(encoding='utf-8-sig'))['transactions']
    live=json.loads(Path(a.live).read_text(encoding='utf-8-sig'))['transactions']
    assert len(live)==len(reviewed)==19, 'incomplete stack'
    records=[]
    for expected,item in zip(reviewed,live):
        h=item.get('hash'); assert h, 'unsigned artifact'
        tx=rpc('eth_getTransactionByHash',[h]); r=rpc('eth_getTransactionReceipt',[h])
        assert tx and r and int(r['status'],16)==1, 'missing or failed receipt'
        assert tx['from'].lower()==DEPLOYER and not tx['to'], 'not expected deployer creation'
        source=expected['transaction']
        for key in ['input','nonce','value']:
            assert tx[key].lower()==source[key].lower(), 'reviewed transaction mismatch: '+key
        assert r['contractAddress'].lower()==expected['contractAddress'].lower(), 'created address mismatch'
        block=rpc('eth_getBlockByNumber',[r['blockNumber'],False])
        assert block['hash']==r['blockHash']==tx['blockHash'], 'noncanonical'
        name=expected['contractName']
        paths=list((ROOT/'out').glob('*/'+name+'.json'))
        assert len(paths)==1, 'ambiguous compiled artifact'
        compiled=json.loads(paths[0].read_text())['deployedBytecode']
        want=bytearray.fromhex(compiled['object'].removeprefix('0x'))
        actual=bytearray.fromhex(rpc('eth_getCode',[r['contractAddress'],r['blockNumber']])[2:])
        assert len(want)==len(actual), 'runtime length mismatch'
        for locations in compiled['immutableReferences'].values():
            for location in locations:
                start=location['start'];end=start+location['length']
                want[start:end]=actual[start:end]=bytes(location['length'])
        metadata_from_reviewed=False
        if want!=actual:
            # Recompiling a different source graph can change the IPFS metadata hash.
            # Never ignore executable differences: also require the complete normalized
            # deployed runtime (including its exact metadata) in the preserved creation input.
            want_meta=int.from_bytes(want[-2:],'big')+2
            actual_meta=int.from_bytes(actual[-2:],'big')+2
            assert want_meta==actual_meta and 2<want_meta<256, 'unexpected metadata layout'
            assert want[:-want_meta]==actual[:-actual_meta], 'executable runtime differs'
            assert actual.hex() in source['input'].lower(), 'runtime not embedded in reviewed creation'
            metadata_from_reviewed=True
        records.append({'name':name,'address':r['contractAddress'],'hash':h,'blockNumber':int(r['blockNumber'],16),
                        'blockHash':r['blockHash'],'gasUsed':int(r['gasUsed'],16),
                        'effectiveGasPrice':int(r['effectiveGasPrice'],16),
                        'metadataProvenFromReviewedCreation':metadata_from_reviewed,'receipt':r})
    report={'chainId':4663,'deploymentVerified':True,'runtimeComparison':'Executable bytes matched with compiler-declared immutable locations normalized; differing metadata proven exactly from preserved reviewed creation input; constructor inputs matched exactly',
            'finalityVerified':False,'canaryCyclesPassed':False,'productionApproved':False,'transactions':records,
            'gasCostWei':sum(x['gasUsed']*x['effectiveGasPrice'] for x in records)}
    Path(a.output).write_text(json.dumps(report,indent=2)+'\n')
    print('Verified 19 actual deployment receipts, reviewed inputs and compiled runtimes.')
    print('Gas cost wei:',report['gasCostWei'])

if __name__=='__main__':main()
