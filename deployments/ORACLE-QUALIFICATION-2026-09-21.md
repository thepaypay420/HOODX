# Oracle qualification checkpoint — 2026-09-21

No successor deployment or new live transaction was performed in this checkpoint. Existing V2 vault configurations are unchanged.

## PRISM and ZEAL

Both maintenance receipts are recorded separately. The expanded history now supports a 30-minute observation window. Current-fork protected round trips passed at 0.0001, 0.001 and 0.005 ETH for each asset (six tests, block 68995011). PRISM uses the direct taxed V2 route; ZEAL uses its V4 route. Both tests derive minimums from independent TWAP references and the explicit fee model, retaining the 97% execution floor. Depth baselines are fixed to pre-maintenance block 68903983, not lowered to match the latest liquidity.

These are route/oracle integration tests, not approval of economic manipulation resistance or a complete vault release. Full vault share accounting, mixed-basket lifecycle and stressed liquidity qualification remain required.

At block 68999564, all three historical-source regressions passed: PRISM capacity preservation, ZEAL capacity preservation, and rejection of the stale QUOTRON reference. Solidity compilation succeeded.

## Stock feed investigation

Read-only candidate report: stock-feed-candidates.json, block 68999254. Official Chainlink directory proxies return positive prices for GOOGL, AMZN, AAPL and META, plus ETH/USD. Token oraclePaused flags were false. Feed ages were 8450, 5358, 4989, 1263 and 650 seconds respectively. These are observations, not freshness thresholds or approvals.

Robinhood's public asset registry matched all five FAANGX constituent addresses and the four queried on-chain multipliers; none of the five registry entries had a pending multiplier. Chainlink's stock-token feed already incorporates its multiplier, so an adapter must not apply it twice.

Unresolved: no NFLX feed found in the downloaded directory; no Robinhood sequencer-uptime proxy listed in Chainlink's supported networks. Market closures, stale-feed rejection, source/token binding, corporate actions, sequencer recovery and reference-versus-executable-price agreement must be resolved before enabling a feed for vault accounting. No feed adapter has been approved or deployed.

Sources:
- https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json
- https://api.robinhood.com/rhj/assets
- https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood
- https://docs.chain.link/data-feeds/l2-sequencer-feeds

## Remaining watchlist gates

NET, Aria, HARMONIC and PROMETHEUS lack usable historical sources in the canonical V3 pools checked. This is not proof that no possible source exists. QUOTRON's existing reference remains stale and cannot be accepted merely because its specialized swap route works. No thresholds were relaxed to accept these assets.

Next qualification work: economically validate the newly matured references; test full successor vault lifecycles with fee-aware accounting; identify independently defensible sources for the remaining assets; resolve stock-feed liveness before testing any replacement configuration on a fork. Existing ETH-only entry choice remains in force.
