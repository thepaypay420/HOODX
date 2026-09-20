# V2 security and validation report

Status: DEVELOPMENT CANDIDATE. Not audited, not release approved, no mainnet deployment.

## Design changes that address historical losses

Normal ETH withdrawal liquidates every proportional constituent and verifies actual output before burning. A failed or no-effect leg reverts the entire transaction. There is no skip-and-burn path.

Direct redemption reserves every pro-rata native/WETH/constituent amount before burning, then attempts separate payouts. Failed transfers retain user-owned claims excluded from future NAV and trading. Automatic payouts are capped at 150,000 gas each; manual retry can use a larger gas budget and another recipient. This cap fixes a concrete issue found during the security review: a gas-burning token or recipient could previously exhaust the whole redemption.

The executor accepts typed routes, fixes targets/recipients, uses canonical pool identities and exact input/output deltas, and rejects any residual movement. Unknown hooks are rejected. Each routed call is atomic even for mixed V3/V4 paths. Universal Router commands use the deployed 2.1.1 ABI, including V3 and V4 minimum-hop-price fields.

No asset-moving delegatecall is used. Clones delegate only to the fixed vault implementation. No rescue-token extraction, arbitrary token sweep, or administrator payout is part of recovery.

## Validation evidence

- Local Foundry: 94 test executions passed, including inherited base cases; this is not a claim of 94 unique scenarios.
- Fuzz tests: 1,024 runs per fuzz case.
- Stateful invariant run: 128 runs x 64 calls, 8,192 calls, zero unexpected reverts. Checks supply, conservation including reserves, and no executor allowances.
- Real canonical router: 21 routing tests passed at latest block 67586616. All 15 official tokens bought and sold; larger amounts, USDG dust regression, minimum-output rollback, and one real return-delta hook.
- Full official baskets: normal deposits, partial ETH withdrawals and final ETH withdrawals passed at block 67591644 and, with the pinned manifest, latest tested block 67610605.
- Stressed historical block 67565367: one 696X sale breaches the 97% TWAP floor. Normal withdrawal reverts without destroying shares; direct redemption empties backing safely. FAANGX normal exit passes. This is emergency-exit evidence, NOT a normal-canary pass.
- Solidity adversarial coverage includes failed/malicious routing, output redirection, excess input, donation attacks, blocked transfers, payout reentrancy, gas-burning transfers/recipients, paused/oracle-failed exits, role separation, 24 constituents, clone locking and constructor-only official setup.
- Frontend: 18 tests and Next production build passed on Node 24. Dependencies report zero known audit findings at the recorded run.
- Historical Python: 111 tests run, 110 passed, one pre-existing skip.
- No live canary transaction has been signed or broadcast.

Fork results are pinned evidence, not a guarantee of future liquidity or prices. Re-run strict canary simulations immediately before any signing.

## Static analysis triage

Slither completed 102 detectors over 57 compiled contracts, returning 89 findings after restricting reported paths to V2. No detector suppressions were added. Aderyn 0.6.8 completed 88 detectors over seven V2 source files: three high-severity categories and fifteen low-severity categories. Original machine reports are preserved in task scratch artifacts; counts include multiple instances and inherited/library reasoning.

High categories:
- Slither arbitrary ETH send: executor sends only to immutable canonical router and WETH; no caller-supplied ETH destination. Trust in constructor references is explicit.
- Slither balance reentrancy / Aderyn state-after-call: trading and exits are guarded; balance deltas are deliberate accounting checks. External self helpers are self-only. Oracle/pool reads use static calls; constructor-only assignments are not a runtime reentry surface. Native payout reentry and malicious routing regressions pass.
- Aderyn locked executor ETH: unsolicited/forced donations to the executor have no recovery mechanism. Successful execution restores the pre-call native/token balances and cannot strand its own routed funds. Do not transfer assets directly to the executor. This limitation is retained rather than creating a sweep authority.
- Aderyn strict balance equality: checks compare to the pre-call balance, not zero. Existing donations do not block execution. Unexpected changes during execution deliberately revert the trade; they cannot burn vault shares.

Other categories:
- Exact-zero / equality checks reject empty trades, invalid bounds and non-exact settlement intentionally.
- ERC20-approval warnings refer to Permit2's non-ERC20 approve API. ERC20 calls use SafeERC20. Some deployed tokens hard-code infinite ERC20 allowance to Permit2 and reject changing it; executor detects that behavior, while its separate Permit2 allowance to the router remains exact and is cleared. Fork tests cover this exception.
- Ignored executor return values are intentional: measured token deltas are authoritative. Tuple fields irrelevant to each operation are intentionally discarded.
- Default-zero locals are Solidity-initialized, not uninitialized memory. Solidity is pinned to 0.8.24 in Foundry.
- Owner checks run before reentrancy guards in some methods but do not call external contracts. Role/address helper validation handles flagged zero-address assignments.
- Timestamp usage is limited to expiry and Permit2 allowance duration.
- Loops are bounded to 24 assets / four route hops. They require gas measurements, not unbounded liveness assumptions.
- Centralization is real: policy owner approves future configurations; curators select approved configurations and target weights. Creator fees have separate authority and hard caps. No curator can take shareholder backing directly.
- Complexity, loop storage caching, numeric style, PUSH0 compatibility, event indexing and shadowing are informational/optimization findings, not suppressed exploit reports. Robinhood supports the configured Cancun bytecode.

## Remaining release gates and limitations

1. The candidate oracle reference list exists for all 15 tokens, and exact route hashes, weights, fees and liquidity retention floors are now pinned to the recorded manifest. Revalidate these fixed parameters before release. Pool balance/liquidity is not a formal bound on multi-block manipulation.
2. V2 uses a 30-minute V3 TWAP and both current/historical liquidity checks, replacing the old 60-second V3 window and V4 spot valuation. This improves resistance to instantaneous manipulation but introduces price-lag availability tradeoffs. The observed protected withdrawal failure demonstrates that tradeoff. Never silently widen the floor to obtain a canary pass.
3. Strict live canary round trips for both configurations, receipt checks and final empty production checks are pending. Deployment/canary scripts require the explicit live switch and matching reviewed-build fingerprint. Production additionally requires verified live-canary receipts, matching build fingerprint and empty canary state.
4. Direct redemption assumes truthful, callable balanceOf and non-rebasing balances. Token upgrades, confiscation, permanent blacklisting or broken balanceOf cannot be repaired by a vault. Failed transfers preserve claims but cannot force an external token to honor them.
5. Hook tests demonstrate one specific capability; they do not approve every hook, hook upgrade or arbitrary hook data. Official candidate routes do not require a hook allowlist.
6. Frontend route validation checks structure/current liquidity, then simulates the complete transaction. It is not an independent exact-output quote for each leg. Market changes between simulation and inclusion can still revert a trade or defer a buy. On-chain accounting remains authoritative.
7. V2 public registry is deliberately empty. No simulated, canary or old address is labeled production V2. Final factory-creation/curator UI integration and address activation remain release work.
8. Source verification, live receipts, treasury sweep and Vercel production activation have not occurred.

No claim is made that the protocol is flawless, risk-free or independently audited.
