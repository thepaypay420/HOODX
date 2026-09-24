import {BaseError, ContractFunctionRevertedError, keccak256, parseAbi, toHex, zeroAddress, type Address, type PublicClient} from 'viem';
import {buildProportionalWithdrawal, type ProportionalSnapshot} from './proportionalPlan';
import {solveProportionalDeposit} from './proportionalSolver';
import {rebalanceControllerV3Abi} from './rebalanceController';

export const proportionalAbi = parseAbi([
  'function accountingMode() pure returns(bytes32)', 'function totalSupply() view returns(uint256)',
  'function constituents() view returns(address[])', 'function weth() view returns(address)',
  'function freeBalance(address) view returns(uint256)', 'function balanceOf(address) view returns(uint256)',
  'function planNonce() view returns(uint256)', 'function creatorFeeBps() view returns(uint16)',
  'function protocolFeeBps() view returns(uint16)', 'function paused() view returns(bool)',
  'function quoteBuys(uint256[] budgets) payable', 'function quoteWithdrawal(uint256 shares)',
  'error BuyQuote(uint256[] outputs)', 'error WithdrawalQuote(uint256 cash,uint256[] outputs)', 'error QuoteUnavailable()',
  'function depositExactShares(uint256 shares,uint256[] budgets,uint256[] floors,uint256 nonce,uint256 deadline) payable returns(uint256 refund)',
  'function withdraw(uint256 shares,uint256 minEthOut,uint256[] floors,uint256 nonce,uint256 deadline) returns(uint256 net)',
]);
const MODE = keccak256(toHex('HOODX_PROPORTIONAL_V1'));
export type ProportionalState = ProportionalSnapshot & {vault: Address; account: Address; tokens: readonly Address[]; walletShares: bigint; paused: boolean};

export async function readProportionalState(client: PublicClient, vault: Address, account: Address): Promise<ProportionalState> {
  if (await client.getChainId() !== 4663) throw new Error('Switch to Robinhood Chain');
  const block = await client.getBlock();
  const common = {address: vault, abi: proportionalAbi, blockNumber: block.number} as const;
  const mode = await client.readContract({...common, functionName: 'accountingMode'});
  if (mode !== MODE) throw new Error('This vault does not support proportional deposits');
  const [tokens, weth, supply, nonce, creatorFeeBps, protocolFeeBps, walletShares, paused] = await Promise.all([
    client.readContract({...common, functionName:'constituents'}), client.readContract({...common, functionName:'weth'}),
    client.readContract({...common, functionName:'totalSupply'}), client.readContract({...common, functionName:'planNonce'}),
    client.readContract({...common, functionName:'creatorFeeBps'}), client.readContract({...common, functionName:'protocolFeeBps'}),
    client.readContract({...common, functionName:'balanceOf', args:[account]}), client.readContract({...common, functionName:'paused'}),
  ]);
  if (tokens.length < 2 || tokens.length > 24 || new Set(tokens.map(t => t.toLowerCase())).size !== tokens.length) throw new Error('Invalid basket');
  const balances = await Promise.all([...tokens, weth, zeroAddress].map(token => client.readContract({...common, functionName:'freeBalance', args:[token]})));
  return {vault, account, tokens, supply, nonce, creatorFeeBps, protocolFeeBps, walletShares, paused,
    balances:balances.slice(0,tokens.length), cash:balances[tokens.length]+balances[tokens.length+1], blockNumber:block.number, timestamp:Number(block.timestamp)};
}

/** Decode only the typed, deliberately reverted result from the verified candidate ABI. */
function quoteResult(error: unknown, name: 'BuyQuote' | 'WithdrawalQuote' | 'RebalanceQuote') {
  const reverted = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined;
  if (!(reverted instanceof ContractFunctionRevertedError) || reverted.data?.errorName !== name || !reverted.data.args) throw new Error('This basket could not be quoted. No transaction was submitted.');
  return reverted.data.args;
}

/** Exact-output observation for one curator rebalance leg. The simulated swap always rolls back. */
export async function quoteProportionalRebalance(
  client: PublicClient,
  state: ProportionalState,
  controller: Address,
  token: Address,
  buy: boolean,
  amount: bigint,
) {
  if (amount <= 0n || !state.tokens.some(t => t.toLowerCase() === token.toLowerCase())) throw new Error('Invalid rebalance leg');
  try {
    await client.simulateContract({
      address: controller,
      abi: rebalanceControllerV3Abi,
      account: state.account,
      functionName: 'quoteRebalance',
      args: [token, buy, amount],
      value: buy ? amount : 0n,
      blockNumber: state.blockNumber,
    });
  } catch (error) {
    const [output] = quoteResult(error, 'RebalanceQuote');
    if (typeof output !== 'bigint' || output <= 0n) throw new Error('Invalid rebalance quote');
    return output;
  }
  throw new Error('Quote simulation unexpectedly succeeded');
}

export async function quoteProportionalDeposit(client: PublicClient, state: ProportionalState, maxEth: bigint, now = () => Math.floor(Date.now()/1000)) {
  if (state.paused) throw new Error('Deposits are paused');
  return solveProportionalDeposit(state, maxEth, async budgets => {
    try {
      await client.simulateContract({address:state.vault, abi:proportionalAbi, account:state.account, functionName:'quoteBuys', args:[budgets], value:budgets.reduce((sum,b) => sum+b,0n), blockNumber:state.blockNumber});
    } catch (error) {
      const [outputs] = quoteResult(error, 'BuyQuote');
      if (!Array.isArray(outputs) || outputs.some(v => typeof v !== 'bigint')) throw new Error('Invalid quote response');
      return outputs as bigint[];
    }
    throw new Error('Quote simulation unexpectedly succeeded');
  }, now);
}

export async function quoteProportionalWithdrawal(client: PublicClient, state: ProportionalState, shares: bigint, now = () => Math.floor(Date.now()/1000)) {
  if (shares <= 0n || shares > state.walletShares) throw new Error('Invalid withdrawal amount');
  try {
    await client.simulateContract({address:state.vault, abi:proportionalAbi, account:state.account, functionName:'quoteWithdrawal', args:[shares], blockNumber:state.blockNumber});
  } catch (error) {
    const [cash, outputs] = quoteResult(error, 'WithdrawalQuote');
    if (typeof cash !== 'bigint' || cash !== state.cash*shares/state.supply || !Array.isArray(outputs) || outputs.length !== state.tokens.length || outputs.some(v => typeof v !== 'bigint')) throw new Error('Invalid quote response');
    const quotes = state.balances.flatMap((balance,index) => {
      const amount = balance*shares/state.supply;
      if (amount === 0n) {if (outputs[index] !== 0n) throw new Error('Unexpected sale output'); return [];}
      return [{index, amount, netEthOutput:outputs[index] as bigint, blockNumber:state.blockNumber}];
    });
    return buildProportionalWithdrawal(state, shares, state.walletShares, quotes, now());
  }
  throw new Error('Quote simulation unexpectedly succeeded');
}

/** Latest-state simulation of the actual protected transaction, never the reverting quote method. */
export async function prepareProportionalDeposit(client: PublicClient, state: ProportionalState, plan: Awaited<ReturnType<typeof quoteProportionalDeposit>>) {
  await validateFresh(client,state,plan.deadline);
  return client.simulateContract({address:state.vault, abi:proportionalAbi, account:state.account, functionName:'depositExactShares', args:[plan.shares,plan.budgets,plan.floors,plan.nonce,plan.deadline], value:plan.value});
}
export async function prepareProportionalWithdrawal(client: PublicClient, state: ProportionalState, plan: Awaited<ReturnType<typeof quoteProportionalWithdrawal>>) {
  await validateFresh(client,state,plan.deadline);
  return client.simulateContract({address:state.vault, abi:proportionalAbi, account:state.account, functionName:'withdraw', args:[plan.shares,plan.minEthOut,plan.floors,plan.nonce,plan.deadline]});
}
async function validateFresh(client: PublicClient,state: ProportionalState,deadline: bigint) {
  if (await client.getChainId() !== 4663) throw new Error('Switch to Robinhood Chain');
  const block = await client.getBlock();
  if (block.timestamp < BigInt(state.timestamp) || block.timestamp > BigInt(state.timestamp+60) || deadline <= block.timestamp) throw new Error('Refresh basket quote');
  if (await client.readContract({address:state.vault,abi:proportionalAbi,functionName:'accountingMode',blockNumber:block.number}) !== MODE) throw new Error('Vault accounting changed');
}
