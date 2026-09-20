"""Read-only, pinned-block canary configuration/balance and actual-receipt evidence."""
import argparse, json, os, urllib.request
from pathlib import Path
from eth_abi import encode, decode
from Crypto.Hash import keccak

ROOT = Path(__file__).resolve().parents[1]
CURATOR = '0x134d468b0bcaea6df127916f951f7938c06a37c6'
DEPLOYER = '0xf63e63a80a25611154c5d1c06e55fd763e0cfc19'
ZERO = '0x' + '0' * 40
WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'

def digest(data):
    return keccak.new(digest_bits=256, data=data).digest()

def rpc(method, params):
    try:
        req = urllib.request.Request(os.environ['ROBINHOOD_RPC_URL'], data=json.dumps(
            dict(jsonrpc='2.0', id=1, method=method, params=params)).encode(),
            headers={'Content-Type':'application/json', 'User-Agent':'HOODX-canary-evidence'})
        with urllib.request.urlopen(req, timeout=60) as response:
            value = json.load(response)
        if 'error' in value: raise ValueError()
        return value['result']
    except Exception:
        raise RuntimeError('Read-only RPC failed: ' + method) from None

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--factory', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--artifact', action='append', default=[])
    p.add_argument('--require-empty', action='store_true')
    args = p.parse_args()
    assert int(rpc('eth_chainId', []), 16) == 4663, 'wrong chain'
    block = rpc('eth_blockNumber', [])
    report = {'chainId':4663, 'block':int(block,16), 'factory':args.factory,
              'vaults':{}, 'receipts':[], 'passed':False, 'productionApproved':False}
    def call(to, sig, returns, types=(), values=()):
        data = digest(sig.encode())[:4] + encode(types, values)
        result = rpc('eth_call', [{'to':to,'data':'0x'+data.hex()},block])
        decoded = decode(returns, bytes.fromhex(result[2:]))
        return decoded[0] if len(decoded)==1 else decoded
    def address(to, sig): return call(to,sig,['address']).lower()
    def num(to, sig, types=(), values=()): return call(to,sig,['uint256'],types,values)
    def balance(token, holder): return num(token,'balanceOf(address)',['address'],[holder])
    assert address(args.factory,'owner()') == CURATOR, 'factory owner'
    assert address(args.factory,'pendingOwner()') == ZERO, 'factory pending owner'
    impl = address(args.factory,'implementation()')
    policy = address(impl,'policy()')
    executor = address(policy,'executor()')
    assert address(policy,'owner()') == CURATOR, 'policy owner'
    assert address(policy,'pendingOwner()') == ZERO, 'policy pending owner'
    manifest = json.loads((ROOT/'deployments/robinhood-4663-routing-v2.json').read_text())
    router = manifest['router']['address']
    code = bytes.fromhex(rpc('eth_getCode',[router,block])[2:])
    assert '0x'+digest(code).hex() == manifest['router']['runtimeKeccak256'], 'router code'
    report.update(implementation=impl,policy=policy,executor=executor)
    all_assets = {WETH,USDG}
    for label,slug in [('696X','696x'),('FAANGX','faangx')]:
        vault = call(args.factory,'bySlug(string)',['address'],['string'],[slug])
        assert rpc('eth_getCode',[vault,block]) != '0x', 'missing vault'
        for role in ['owner','creator','creatorRecipient','treasury']:
            assert address(vault,role+'()') == CURATOR, label+' '+role
        assert address(vault,'pendingOwner()') == ZERO, 'vault pending owner'
        assert address(vault,'policy()') == policy and address(vault,'executor()') == executor, 'integration'
        assert address(vault,'weth()') == WETH, 'weth'
        settings = manifest['settings'][label]
        for field in ['name','symbol','imageURI']:
            assert call(vault,field+'()',['string']) == settings[field], field
        for field in ['creatorFeeBps','protocolFeeBps','minFirstDeposit']:
            assert num(vault,field+'()') == int(settings[field]), field
        assert num(vault,'cashTargetBps()') == 2500, 'cash target'
        assets = [a for a in manifest['assets'] if a['vault']==label]
        tokens = list(call(vault,'constituents()',['address[]']))
        assert [t.lower() for t in tokens] == [a['token'].lower() for a in assets], 'constituents'
        for a in assets:
            token = a['token']; all_assets.add(token)
            assert num(vault,'targetBps(address)',['address'],[token]) == a['targetBps'], 'weight'
            config = call(vault,'configId(address)',['bytes32'],['address'],[token])
            t,oracle,buy,sell = call(policy,'config(bytes32)',['address','address','bytes','bytes'],['bytes32'],[config])
            assert t.lower()==token.lower() and '0x'+buy.hex()==a['buy'] and '0x'+sell.hex()==a['sell'], 'routes'
            assert address(oracle,'pool()') == a['referencePool'].lower(), 'reference'
            assert address(oracle,'bridge()') == (a['referenceBridge'] or ZERO).lower(), 'bridge'
            assert num(oracle,'window()') == 1800, 'window'
            assert num(oracle,'minLiquidity()') == int(a['minimumLiquidity']), 'depth'
            assert num(oracle,'minBridgeLiquidity()') == int(a['minimumBridgeLiquidity']), 'bridge depth'
        holdings = {t:balance(t,vault) for t in sorted(set(tokens+[WETH,USDG]))}
        reserves = {t:num(vault,'reserved(address)',['address'],[t]) for t in [ZERO]+list(holdings)}
        claims = {who:{t:num(vault,'claimable(address,address)',['address','address'],[who,t]) for t in reserves} for who in [DEPLOYER,CURATOR]}
        state = dict(address=vault,paused=call(vault,'paused()',['bool']),shares=balance(vault,DEPLOYER),
                     totalSupply=num(vault,'totalSupply()'),totalAssets=num(vault,'totalAssets()'),
                     nativeWei=int(rpc('eth_getBalance',[vault,block]),16),holdings=holdings,reserves=reserves,claims=claims)
        report['vaults'][label] = state
        if args.require_empty:
            assert all(state[k]==0 for k in ['shares','totalSupply','totalAssets','nativeWei']), 'not empty'
            assert not any(holdings.values()) and not any(reserves.values()), 'dust or reserves'
            assert all(not any(c.values()) for c in claims.values()), 'pending claims'
    report['balances'] = {holder:{t:balance(t,holder) for t in sorted(all_assets)} for holder in [DEPLOYER,executor,router]}
    report['deployerETHWei'] = int(rpc('eth_getBalance',[DEPLOYER,block]),16)
    for path in args.artifact:
        artifact = json.loads(Path(path).read_text())
        assert 'dry-run' not in str(path), 'simulation artifact is not live evidence'
        for item in artifact['transactions']:
            h = item.get('hash'); assert h, 'unsigned transaction'
            tx = rpc('eth_getTransactionByHash',[h]); r = rpc('eth_getTransactionReceipt',[h])
            assert tx and r and int(r['status'],16)==1, 'missing or failed receipt'
            assert tx['from'].lower()==DEPLOYER and r['from'].lower()==DEPLOYER, 'sender'
            canonical = rpc('eth_getBlockByNumber',[r['blockNumber'],False])
            assert canonical['hash']==r['blockHash']==tx['blockHash'], 'noncanonical receipt'
            assert r['transactionHash']==h, 'hash mismatch'
            report['receipts'].append({'transaction':tx,'receipt':r})
    report['passed'] = True
    Path(args.output).write_text(json.dumps(report,indent=2)+'\n')
    print('Pinned canary state/configuration verified at block',report['block'])
    print('Actual canonical receipts checked:',len(report['receipts']))
    print('This does not alone certify source equivalence, finality or complete canary history.')

if __name__=='__main__': main()
