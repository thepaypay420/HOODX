# HOODX Liquidity Index research

Date: 2026-09-27
Status: protocol-pilot implementation and fork rehearsal; no deployment or production transaction

## Decision

The idea is strong and fits HOODX, but an LP index must not be implemented as another `HoodxProportionalV3` token basket. Concentrated-liquidity positions are ERC-721 positions with range state, fee growth, and lifecycle calls. The existing vault assumes fungible ERC-20 constituents with buy/sell routes.

The recommended product is a new immutable **HOODX Liquidity Index** whose ERC-20 shares represent a portfolio of fungible LP-sleeve vaults. Each sleeve owns and manages one reviewed Uniswap V3 pool position. The index holds sleeve shares plus a WETH reserve. This preserves the current HOODX product language—deposit, withdraw, harvest, restore, deploy reserve, direct recovery—while isolating pool-specific position logic.

Do not launch V4-hook sleeves in the first release. A dynamic hook is additional executable trust and failure surface. Review each hook family separately after the V3 product is proven.

## What Krystal proves, and what HOODX can add

Krystal validates demand for six actions: add liquidity, remove liquidity, rebalance, harvest, compound, and automated range management. Its automation includes trigger ranges, time buffers, minimum fee thresholds, gas ceilings, and separate pool/swap slippage. Its newer agent model also exposes explicit action permissions, pool/protocol scopes, cooldowns, and allocation caps.

HOODX's advantage is different: one liquid index token, public portfolio rules, atomic curator actions, visible recent management, a WETH reserve, and direct recovery that does not depend on the website or an off-chain agent. The user buys one share token while the curator manages several LP sleeves.

## Robinhood Chain pool snapshot

Krystal was filtered to Robinhood Chain and inspected on 2026-09-27. Figures are volatile 24-hour observations, not forecasts and not audited accounting.

| Sleeve | Protocol | Fee | TVL | 24h volume | 24h fees | 24h APR shown | Role |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| WETH / USDG | Uniswap V3 | 0.01% | $19.7M | $249.5M | $18.7K | 34.65% list; 12.75% example range | Defensive/core |
| WETH / SPY | Uniswap V3 | 0.05% | $1.7M | $3.53M | $1.33K | 28.52% list; 10.1% example range | RWA differentiator |
| WETH / PONS | Uniswap V3 | 0.30% | $5.0M | $5.71M | $14.3K | 104.73% | Core culture |
| CASHCAT / WETH | Uniswap V3 | 0.30% | $2.8M | $8.58M | $21.4K | 275.72% | Growth/culture |
| WETH / AI | Uniswap V3 | 1.00% | $3.1M | $1.73M | $14.4K | 170.70% | High-risk satellite |

Reviewed pool addresses:

- WETH/USDG: `0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca`
- WETH/SPY: `0xddCBbA3666f578E3F09516f21Ff85bFEe859aB5e`
- WETH/PONS: `0xEd50bDeeA8aDC232f159486192a4157281D722ff`
- CASHCAT/WETH: `0xd42A491087a15E5afd51FEb3606066Cc152d2b09`
- WETH/AI: `0xc4a21f9d6485FC5893DD4A491B320a83DAF4Da1D`

All five resolved at Robinhood block `74,572,742` to Uniswap V3 factory `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`, the expected token pair and fee tier, an initialized price, an unlocked pool, and nonzero active liquidity.

### Proposed first basket

Start with four sleeves and a reserve:

- 30% WETH/USDG
- 25% WETH/SPY
- 20% WETH/PONS
- 10% CASHCAT/WETH
- 15% WETH reserve

WETH/AI should remain a reviewed alternate until its 7-day and 30-day net performance, range uptime, and drawdown behavior beat CASHCAT after impermanent loss and re-band costs. Weighting must be risk-adjusted, never APR-weighted.

### Later stable-liquidity basket

The second product should be a separate, more conservative stablecoin index rather than changing Liquidity Prime. Candidate sleeves must first pass issuer, bridge, depeg, freeze/blacklist, depth, and exit-route review. A sensible shape is 70–85% stable/stable sleeves, 10–20% uncommitted stable reserve, and no more than 35% exposure to one non-native issuer. Re-band rules should use much narrower ranges but longer depeg confirmation, and a depeg must move the sleeve into recovery mode rather than repeatedly chasing the price. No stablecoin is treated as risk-free, and no pool is admitted from symbol/name alone.

## Implemented pilot shape

### 1. `HoodxLiquiditySleeveV1`

One immutable sleeve per reviewed pool family:

- owns Uniswap V3 position NFTs;
- mints fungible ERC-20 sleeve shares;
- only accepts the pinned factory, position manager, tokens, fee tier, and pool;
- accepts controller funding only before index bootstrap;
- supports fee collection, no-swap compounding, re-banding, and direct pair-token redemption;
- closes and burns the old position before completing a re-band;
- never values itself from the current pool spot price.

### 2. `HoodxLiquidityIndexV1`

- ERC-20 index share token;
- holds approved sleeve shares and a WETH reserve;
- maximum four active sleeves in the first version;
- deliberately has no public deposit path in V1; the reviewed seed is one-time and protocol-controlled;
- direct unwrap burns index shares into pro-rata WETH plus independent ERC-20 sleeve shares;
- every sleeve share can then redeem directly to its pair, so a failed pool cannot block the healthy sleeves;
- no website, keeper, quote service, or cache is required for direct recovery.

### 3. `HoodxLiquidityControllerV1`

The implemented controller provides:

- **Harvest** — collect fees into a sleeve.
- **Compound** — reinvest pair balances with minimum token-use and minimum-liquidity checks.
- **Re-center ranges** — permissionless edge signalling followed by curator-only execution after TWAP agreement, dwell and cooldown checks.
- **Pause management** — stop funding, harvesting, compounding and re-banding without stopping holder redemption.

Weight restoration, WETH-only entry/exit, and the curator transaction cards remain intentionally outside the V1 canary. They require a protected swap adapter and full cross-sleeve NAV accounting. Adding those shortcuts before that accounting is proven would make the pilot less safe.

## Valuation and share fairness

Pool spot prices are manipulable and must not determine share issuance. A production design needs independent, bounded price references for every token and must account for:

- amounts represented by each position at current tick;
- uncollected fees;
- idle pair tokens and WETH;
- the Robinhood Stock Token `uiMultiplier()` for corporate actions such as splits;
- stale, missing, or disputed prices.

When any required valuation is invalid, WETH entry and WETH exit close safely. Direct in-kind redemption remains available.

An alternative oracle-minimized design is proportional in-kind entry into every sleeve. It is less friendly for users and still needs correct fee-growth accounting, so it is not the recommended public flow.

## Range and automation policy

The recommended authority split is **programmatic execution, optional AI advice**. AI may rank opportunities or recommend new widths, but it should never custody funds, bypass a cooldown, select an unreviewed pool, or create executable calldata. The controller enforces the active policy on-chain.

The pilot does not re-band on a fixed clock. Anyone may call `signal` when a sleeve reaches its edge; only the curator may execute after the condition persists. Initial policy:

| Sleeve | Width from center | TWAP | Edge dwell | Minimum re-band interval |
| --- | ---: | ---: | ---: | ---: |
| WETH/USDG | 2,000 ticks | 30 min | 1 hour | 12 hours |
| WETH/SPY | 4,000 ticks | 1 hour | 4 hours | 24 hours |
| WETH/PONS | 6,000 ticks | 30 min | 30 min | 6 hours |
| CASHCAT/WETH | 7,200 ticks | 30 min | 30 min | 6 hours |

This event-driven cadence avoids needless churn. SPY receives the slowest confirmation because of equity-market gaps and corporate-action risk. The culture sleeves use wide ranges and shorter confirmation because their volatility is higher, but still cannot churn more than four times per day. An edge observation must be refreshed at least every 30 minutes; if the keeper or RPC is unavailable longer than that, the dwell timer restarts. These are canary limits, not permanent optimization claims.

Additional boundaries:

- one reviewed protocol family: Uniswap V3;
- four active sleeves maximum;
- 35% maximum sleeve weight;
- 15% minimum WETH reserve;
- minimum pool TVL and 7-day median liquidity requirements;
- minimum range width per fee tier;
- minimum time out of range before re-band;
- minimum collected fees before compound;
- cooldown between automated operations;
- maximum gas and swap impact;
- per-action and daily turnover caps;
- no keeper ability to change approved pools, fee tiers, risk limits, or recipient addresses.

The curator can pause new deposits. Users retain direct in-kind recovery while paused.

## Threat model and required tests

Launch blockers until proven:

1. **Share manipulation:** donation, first-deposit inflation, fee-sniping immediately before harvest, rounding at minimal deposits, and corporate-action multiplier changes.
2. **Position lifecycle:** mint/increase/decrease/collect/burn at, inside, and outside range; zero-liquidity positions; partially filled swaps; old token IDs after re-band.
3. **Atomicity:** any bad minimum, stale tick, unavailable route, or failed sleeve must revert the management plan without changing weights or leaving approvals.
4. **Recovery:** one bad token or sleeve must not block claims from healthy sleeves; retries must remain possible.
5. **Token behavior:** transfer taxes, rebasing, callbacks, revert-on-transfer, gas-heavy tokens, unsolicited tokens/NFTs, and native ETH donations.
6. **Oracle safety:** stale feeds, pool manipulation, divergent references, closed stock-market sessions, and `uiMultiplier()` changes.
7. **Keeper griefing:** replay, stale plans, excessive calls, re-band churn, cooldown reset, gas griefing, and malicious sequencing.
8. **Worst case:** four sleeves, maximum token IDs, maximum tick crossings, and full withdrawal at once.

## Evidence completed

- `LiquidityIndexPoolsFork.t.sol`: pinned read-only Robinhood fork verification for all five candidate V3 pools.
- `LiquidityIndexAccounting.t.sol`: donation-resistant share preview, pro-rata redemption, and 1,024-run fuzz coverage that a positive donation cannot cause excess share issuance.
- `LiquidityPilotV1.t.sol`: controller activation, one-time bootstrap, funding lock after bootstrap, proportional unwrap, direct redemption while management is paused, compound accounting, TWAP divergence rejection, dwell, cooldown, missed-observation reset, deterministic re-band, and 1,024 fuzzed proportional recoveries.
- `LiquiditySleeveFork.t.sol`: canonical Robinhood Uniswap V3 position-manager mint and complete direct-recovery burn lifecycle at current chain state for every pilot sleeve, plus a complete four-sleeve parent-index bootstrap and recovery.
- `RehearseLiquidityPrimeV1.s.sol`: no-broadcast deployment and ownership wiring for all four sleeves, the index, and controller on Robinhood Chain. Estimated rehearsal cost was about `0.000724 ETH` at the observed gas price.
- No production state was modified.

## UNVERIFIED before implementation approval

- Seven-day and 30-day net fee return after impermanent loss, gas, re-band costs, and inactive-range time.
- The public Robinhood RPC cannot provide arbitrary-account historical state at block `74,572,742`; therefore the position-manager lifecycle passed at current state while the five pool identities remain pinned read-only evidence. A fully pinned lifecycle remains UNVERIFIED until an archival endpoint is available.
- Reliable independent price references for PONS, CASHCAT, and AI.
- SPY trading-state behavior, canonical registry identity, oracle behavior, and `uiMultiplier()` handling.
- Protected swap and NAV accounting needed for WETH-only entry/exit and cross-sleeve weight restoration.
- Gas feasibility for a four-sleeve WETH deposit, re-band, and full exit.
- Independent security review of the sleeve, index, controller, adapters, and keeper policy.

## Build sequence

1. Add a read-only LP research indexer and retain 7/30-day pool history. No funds.
2. ~~Implement interfaces and a mock sleeve; prove accounting and partial recovery.~~ Complete.
3. ~~Implement the Uniswap V3 adapter and exercise the full lifecycle against canonical contracts.~~ Complete at current state; archival pinned lifecycle outstanding.
4. ~~Add the four-sleeve index and deterministic controller.~~ Core pilot complete; protected swaps intentionally excluded.
5. Run independent security review, failure injection, fuzz/invariant expansion and four-sleeve gas tests.
6. Deploy an empty canary only after review. Seed a small protocol position after harvest, compound, re-band, unwrap and per-sleeve recovery pass from unrelated wallets.
7. Add public WETH entry only in a later version with independently reviewed NAV accounting. The future permissionless factory should deploy isolated instances from reviewed adapters; curated Explore visibility stays separate from permissionless on-chain creation.

## Sources

- Krystal Robinhood pool explorer: https://defi.krystal.app/pools?chainIds=robinhood
- Krystal auto-rebalance: https://docs.krystal.app/products/liquidity-management/lp-transactions/auto-rebalance
- Krystal agent permissions and scopes: https://docs.krystal.app/products/vaults/auto-farm/manage-an-auto-farm-vault
- Uniswap concentrated liquidity: https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/concentrated-liquidity
- Uniswap V3 position custody: https://developers.uniswap.org/docs/protocols/v3/guides/managing-liquidity/getting-started
- Robinhood Chain overview: https://docs.robinhood.com/chain/
- Robinhood stock-token behavior: https://docs.robinhood.com/chain/stock-tokens/
- Robinhood canonical token registry: https://docs.robinhood.com/chain/contracts/
