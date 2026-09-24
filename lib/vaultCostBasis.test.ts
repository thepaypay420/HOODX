import { describe, expect, it } from "vitest";
import { acquire, applyReceiptTransfers, dispose, emptyBasis, positionGain, type VaultTransfer } from "./vaultCostBasis";

const vault = "0x00000000000000000000000000000000000000aa" as const;
const weth = "0x00000000000000000000000000000000000000bb" as const;
const token = "0x00000000000000000000000000000000000000cc" as const;
const other = "0x00000000000000000000000000000000000000dd" as const;
const zero = "0x0000000000000000000000000000000000000000" as const;
const hash = `0x${"1".repeat(64)}` as const;
const tx = (tokenAddress: typeof token | typeof weth, from: typeof vault | typeof zero, to: typeof vault | typeof zero, amount: bigint, logIndex: number): VaultTransfer => ({token:tokenAddress,from,to,amount,logIndex,blockNumber:1n,transactionHash:hash});

describe("vault cost basis", () => {
  it("tracks weighted average cost and realized pnl", () => {
    let p=acquire(emptyBasis(token),100n,50n); p=acquire(p,100n,150n); p=dispose(p,50n,80n);
    expect(p).toMatchObject({units:150n,costWei:150n,realizedPnlWei:30n,proceedsWei:80n});
    expect(positionGain(p,225n)).toEqual({gainWei:75n,gainBps:5000n});
  });
  it("uses actual received units for taxed-token buys", () => {
    const positions=new Map();
    applyReceiptTransfers(positions,[tx(weth,vault,zero,100n,1),tx(token,zero,vault,97n,4)],vault,weth);
    expect(positions.get(token)).toMatchObject({units:97n,costWei:100n,complete:true});
  });
  it("recognizes sales and treats an unpaired asset exit as an in-kind disposal", () => {
    const positions=new Map([[token,acquire(emptyBasis(token),100n,100n)],[other,acquire(emptyBasis(other),50n,80n)]]);
    applyReceiptTransfers(positions,[tx(token,vault,zero,40n,1),tx(weth,zero,vault,70n,5),{...tx(token,vault,zero,1n,6),token:other}],vault,weth);
    expect(positions.get(token)).toMatchObject({units:60n,costWei:60n,realizedPnlWei:30n});
    expect(positions.get(other)).toMatchObject({units:49n,costWei:79n,realizedPnlWei:0n});
  });
  it("marks unexplained token inflows and over-disposals incomplete", () => {
    const positions=new Map();
    applyReceiptTransfers(positions,[tx(token,zero,vault,10n,1),tx(token,vault,zero,20n,2)],vault,weth);
    expect(positions.get(token)?.complete).toBe(false);
  });
});
