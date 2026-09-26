# Official vault route-capacity review

Read-only review at Robinhood Chain block `72794421`. No production transaction was broadcast.

## Result

The ten new official vaults do not need replacement solely for current pool depth.

- All ten vaults still have zero supply.
- Every exact live basket simulated bootstrap successfully at `0.02`, `0.1`, `0.5`, and `1 ETH` gross entry sizes: 40 successful basket simulations.
- At a `1 ETH` gross entry, the largest individual sleeve was at most `0.24875 ETH`.
- RCAT was the weakest stressed route and retained `99.70%` of its small-entry quote efficiency.
- USAR retained `99.87%`; every other vault's weakest route retained at least `99.94%`.
- The launch catalog recorded median asset-pool liquidity of about `$390,422`; the minimum was SHOP at about `$44,939`.

## Topology

The liquidity is concentrated as expected. Forty-three of 47 assets use their asset/USDG pool plus the shared USDG/WETH bridge; four use direct WETH pools. This reduces fragmentation and gives most baskets the same deep bridge, but it also makes that bridge a shared dependency.

Dynamic route fallback would improve operational redundancy if a pool or shared bridge becomes unavailable. The measurements do not justify abandoning or recreating the ten empty vaults now. Current capacity is comfortably above the planned `0.02 ETH` seed and remained efficient through the tested `1 ETH` entry.

## Limits

- The live vaults are empty, so large current-state ETH withdrawals cannot be exercised without changing production state.
- The exact baskets previously completed `0.02 ETH` bootstrap and full ETH exit lifecycles on a local fork.
- Pool liquidity can change. Direct proportional redemption remains the price-independent recovery path if an ETH route becomes unavailable.
- A single configured route remains an availability dependency even when its liquidity is deep.

Machine-readable evidence: `official-vault-capacity-audit-2026-09-25.json`.
