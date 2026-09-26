/** Read-only route discovery for additions to the 696X successor manifest. */
import fs from 'node:fs';
import {
  createPublicClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  parseAbiParameters,
} from 'viem';

const assets = [
  { symbol: 'musebook', token: '0x91A2DAe9699f0B82540B5886b0d8759C22820bA3' },
  { symbol: 'STELX', token: '0x7A8cda6A1cAB3e5146Cd13Cb623a3bb284fb4aD1' },
];
const rpc = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';
const integrations = JSON.parse(fs.readFileSync('deployed.json'));
const client = createPublicClient({ transport: http(rpc, { retryCount: 1, timeout: 20_000 }) });
const zero = '0x0000000000000000000000000000000000000000';
const abi = parseAbi([
  'function v3Factory() view returns(address)',
  'function getPool(address,address,uint24) view returns(address)',
  'function liquidity() view returns(uint128)',
  'function observe(uint32[]) view returns(int56[],uint160[])',
  'function poolKeys(bytes25) view returns(address,address,uint24,int24,address)',
  'function getLiquidity(bytes32) view returns(uint128)',
  'function compatibleHook(address) view returns(bool)',
  'function symbol() view returns(string)',
  'function name() view returns(string)',
  'function decimals() view returns(uint8)',
  'function totalSupply() view returns(uint256)',
]);

const block = await client.getBlockNumber();
const read = (address, functionName, args = []) =>
  client.readContract({ address, abi, functionName, args, blockNumber: block });
const executor = '0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750';
const v3Factory = await read(executor, 'v3Factory');
const report = {
  chainId: await client.getChainId(),
  block: String(block),
  sampledAt: new Date().toISOString(),
  executor,
  assets: [],
};
if (report.chainId !== 4663) throw new Error('Wrong chain');

for (const asset of assets) {
  const row = {
    ...asset,
    name: await read(asset.token, 'name'),
    onchainSymbol: await read(asset.token, 'symbol'),
    decimals: await read(asset.token, 'decimals'),
    totalSupply: String(await read(asset.token, 'totalSupply')),
    codeHash: keccak256(await client.getCode({ address: asset.token, blockNumber: block })),
    references: [],
    pools: [],
  };
  const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${asset.token}`);
  if (!response.ok) throw new Error(`Listings unavailable for ${asset.symbol}`);
  const listings = await response.json();
  const pairs = listings.filter(
    (pair) => pair.chainId === 'robinhood' && pair.baseToken.address.toLowerCase() === asset.token.toLowerCase(),
  );
  row.market = pairs
    .map((pair) => ({
      id: pair.pairAddress,
      version: pair.labels?.[0] || 'unknown',
      quote: pair.quoteToken.address,
      quoteSymbol: pair.quoteToken.symbol,
      marketCapUsd: pair.marketCap ?? null,
      liquidityUsd: pair.liquidity?.usd ?? null,
      volume24hUsd: pair.volume?.h24 ?? null,
    }))
    .sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));

  const quotes = new Set([
    integrations.weth.toLowerCase(),
    '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    ...pairs.map((pair) => pair.quoteToken.address.toLowerCase()).filter((quote) => quote !== zero),
  ]);
  for (const quote of quotes) {
    for (const fee of [100, 500, 3000, 10000]) {
      const pool = await read(v3Factory, 'getPool', [asset.token, quote, fee]);
      if (pool.toLowerCase() === zero) continue;
      const reference = {
        pool,
        quote,
        fee,
        liquidity: String(await read(pool, 'liquidity')),
        history1800: false,
      };
      try {
        const [, accumulators] = await read(pool, 'observe', [[1800, 0]]);
        reference.history1800 = true;
        const delta = (accumulators[1] - accumulators[0] + (1n << 160n)) % (1n << 160n);
        reference.harmonicLiquidity = delta ? String((1800n << 128n) / delta) : '0';
      } catch {
        reference.historyError = 'Observation unavailable';
      }
      row.references.push(reference);
    }
  }

  for (const pair of pairs) {
    const pool = {
      id: pair.pairAddress,
      version: pair.labels?.[0] || 'unknown',
      quote: pair.quoteToken.address,
      displayLiquidityUsd: pair.liquidity?.usd ?? null,
    };
    if (pool.version === 'v4') {
      try {
        const values = await read(integrations.v4Posm, 'poolKeys', [pool.id.slice(0, 52)]);
        pool.key = {
          currency0: values[0],
          currency1: values[1],
          fee: values[2],
          tickSpacing: values[3],
          hooks: values[4],
        };
        pool.identityMatches =
          keccak256(
            encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), values),
          ).toLowerCase() === pool.id.toLowerCase();
        pool.activeLiquidity = String(await read(integrations.v4StateView, 'getLiquidity', [pool.id]));
        pool.hookAllowed =
          pool.key.hooks.toLowerCase() === zero || (await read(executor, 'compatibleHook', [pool.key.hooks]));
      } catch {
        pool.discoveryError = 'Pool key or liquidity unavailable';
      }
    }
    row.pools.push(pool);
  }
  report.assets.push(row);
}

fs.writeFileSync(
  'deployments/696x-watchlist-additions-discovery-2026-09-26.json',
  `${JSON.stringify(report, null, 2)}\n`,
);
for (const row of report.assets) {
  console.log(
    JSON.stringify({
      symbol: row.symbol,
      token: row.token,
      onchainSymbol: row.onchainSymbol,
      codeHash: row.codeHash,
      references: row.references.filter((reference) => BigInt(reference.liquidity) > 0n),
      v4Candidates: row.pools.filter(
        (pool) => pool.version === 'v4' && pool.identityMatches && BigInt(pool.activeLiquidity || 0) > 0n,
      ),
    }),
  );
}
