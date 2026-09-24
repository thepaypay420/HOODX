import type { Address, Hex } from "viem";

export type BasisPosition = {
  token: Address;
  units: bigint;
  costWei: bigint;
  realizedPnlWei: bigint;
  acquiredUnits: bigint;
  acquiredCostWei: bigint;
  disposedUnits: bigint;
  proceedsWei: bigint;
  complete: boolean;
};

export type VaultTransfer = {
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
};

export function emptyBasis(token: Address): BasisPosition {
  return { token, units: 0n, costWei: 0n, realizedPnlWei: 0n, acquiredUnits: 0n, acquiredCostWei: 0n, disposedUnits: 0n, proceedsWei: 0n, complete: true };
}

export function acquire(position: BasisPosition, units: bigint, costWei: bigint): BasisPosition {
  if (units <= 0n || costWei < 0n) return position;
  return { ...position, units: position.units + units, costWei: position.costWei + costWei, acquiredUnits: position.acquiredUnits + units, acquiredCostWei: position.acquiredCostWei + costWei };
}

export function dispose(position: BasisPosition, units: bigint, proceedsWei?: bigint): BasisPosition {
  if (units <= 0n) return position;
  if (units > position.units) return { ...position, units: 0n, costWei: 0n, disposedUnits: position.disposedUnits + units, complete: false };
  const removedCost = position.units === 0n ? 0n : position.costWei * units / position.units;
  return {
    ...position,
    units: position.units - units,
    costWei: position.costWei - removedCost,
    disposedUnits: position.disposedUnits + units,
    proceedsWei: position.proceedsWei + (proceedsWei ?? 0n),
    realizedPnlWei: position.realizedPnlWei + (proceedsWei === undefined ? 0n : proceedsWei - removedCost),
  };
}

// Reconstructs vault-level average cost from actual settled transfers. This is
// deliberately independent from calldata amounts so taxed tokens use the units
// the vault really received or sent.
export function applyReceiptTransfers(
  positions: Map<string, BasisPosition>,
  transfers: VaultTransfer[],
  vault: Address,
  weth: Address,
) {
  const v = vault.toLowerCase(), w = weth.toLowerCase();
  const relevant = transfers.filter(t => t.from.toLowerCase() === v || t.to.toLowerCase() === v).sort((a, b) => a.logIndex - b.logIndex);
  let pendingBuy: { cost: bigint } | undefined;
  let pendingSell: { token: Address; units: bigint } | undefined;

  const unpairedSell = () => {
    if (!pendingSell) return;
    const key = pendingSell.token.toLowerCase();
    positions.set(key, dispose(positions.get(key) ?? emptyBasis(pendingSell.token), pendingSell.units));
    pendingSell = undefined;
  };

  for (const transfer of relevant) {
    const token = transfer.token.toLowerCase(), incoming = transfer.to.toLowerCase() === v;
    if (token === w) {
      if (!incoming) {
        unpairedSell();
        pendingBuy = { cost: transfer.amount };
      } else if (pendingSell) {
        const key = pendingSell.token.toLowerCase();
        positions.set(key, dispose(positions.get(key) ?? emptyBasis(pendingSell.token), pendingSell.units, transfer.amount));
        pendingSell = undefined;
      }
      continue;
    }
    if (incoming) {
      const key = token;
      if (pendingBuy) {
        positions.set(key, acquire(positions.get(key) ?? emptyBasis(transfer.token), transfer.amount, pendingBuy.cost));
        pendingBuy = undefined;
      } else {
        const prior = positions.get(key) ?? emptyBasis(transfer.token);
        positions.set(key, { ...acquire(prior, transfer.amount, 0n), complete: false });
      }
    } else {
      unpairedSell();
      pendingBuy = undefined;
      pendingSell = { token: transfer.token, units: transfer.amount };
    }
  }
  unpairedSell();
  return positions;
}

export function positionGain(position: BasisPosition, currentValueWei: bigint) {
  const gainWei = currentValueWei - position.costWei;
  const gainBps = position.costWei > 0n ? gainWei * 10000n / position.costWei : undefined;
  return { gainWei, gainBps };
}
