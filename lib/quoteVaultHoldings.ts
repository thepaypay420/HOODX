import { decodeAbiParameters, parseAbi, parseAbiParameters, zeroAddress, type Address, type PublicClient } from "viem";
const abi = parseAbi([
  "function totalSupply() view returns(uint256)", "function constituents() view returns(address[])", "function weth() view returns(address)", "function policy() view returns(address)",
  "function freeBalance(address) view returns(uint256)", "function configId(address) view returns(bytes32)",
  "function config(bytes32) view returns(address token,address oracle,bytes buy,bytes sell)",
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)",
]);
const q4Abi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData)) returns(uint256,uint256)"]);
const routeType = parseAbiParameters("(uint8 kind,address tokenIn,address tokenOut,uint24 fee,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint256 minHopPriceX36,bytes hookData)[]");
export async function quoteVaultHoldings(client: PublicClient, vault: Address) {
  const block = await client.getBlock();
  const read = { abi, blockNumber: block.number } as const;
  const [tokens, weth, policy, supply] = await Promise.all([
    client.readContract({ ...read, address: vault, functionName: "constituents" }),
    client.readContract({ ...read, address: vault, functionName: "weth" }),
    client.readContract({ ...read, address: vault, functionName: "policy" }),
    client.readContract({ ...read, address: vault, functionName: "totalSupply" }),
  ]);
  const norm = (a: Address) => (a === zeroAddress ? weth : a).toLowerCase();
  const cash = await Promise.all([zeroAddress,weth].map(token => client.readContract({ ...read, address: vault, functionName:"freeBalance", args:[token] })));
  const rows = [];
  for (const token of tokens) {
    const balance = await client.readContract({ ...read, address:vault, functionName:"freeBalance", args:[token] });
    if (!balance) continue;
    const id = await client.readContract({ ...read, address:vault, functionName:"configId", args:[token] });
    const [configuredToken,,,sell] = await client.readContract({ ...read, address:policy, functionName:"config", args:[id] });
    if (configuredToken.toLowerCase() !== token.toLowerCase()) throw Error("Route identity mismatch");
    const [hops] = decodeAbiParameters(routeType,sell);
    if (!hops.length || hops.length>4) throw Error("Unsupported route length");
    let amount=balance, previous=token;
    for (const hop of hops) {
      if (norm(hop.tokenIn)!==norm(previous)) throw Error("Disconnected route");
      if (hop.kind===3) {
        const {result} = await client.simulateContract({address:"0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",abi,functionName:"quoteExactInputSingle",args:[{tokenIn:hop.tokenIn,tokenOut:hop.tokenOut,amountIn:amount,fee:hop.fee,sqrtPriceLimitX96:0n}],blockNumber:block.number});
        amount=result[0];
      } else if (hop.kind===4) {
        if(amount >= 1n<<128n) throw Error("Quote amount too large");
        const {result}=await client.simulateContract({address:"0x8dc178efb8111bb0973dd9d722ebeff267c98f94",abi:q4Abi,functionName:"quoteExactInputSingle",args:[{poolKey:hop.key,zeroForOne:hop.tokenIn.toLowerCase()===hop.key.currency0.toLowerCase(),exactAmount:amount,hookData:hop.hookData}],blockNumber:block.number});
        amount=result[0];
      } else throw Error("Unsupported quote route");
      if(amount<=0n)throw Error("Empty quote");
      previous=hop.tokenOut;
    }
    if(norm(previous)!==norm(weth))throw Error("Route does not end in ETH");
    rows.push({token,balance:String(balance),ethValue:String(amount)});
  }
  return {vault,supply:String(supply),block:String(block.number),timestamp:Number(block.timestamp)*1000,assets:String(cash[0]+cash[1]+rows.reduce((n,r)=>n+BigInt(r.ethValue),0n)),rows};
}
