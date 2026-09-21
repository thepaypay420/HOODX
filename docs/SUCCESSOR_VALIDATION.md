# Opt-in successor: development checkpoint

Existing deployed V2 vaults are unchanged. No successor contract has been broadcast.
This checkpoint is not a release approval or a claim that arbitrary tokens are safe.

## Implemented foundation

- Separate V3 executor, vault and factory; accounting is based on V2, with successor-only fee handling described below.
- Canonical standard-fee V2 pair execution alongside V3/V4 execution.
- Delayed, code-hash-pinned hook registry with immediate owner revocation.
- Exact balance settlement checks; taxed V2 transfers are deliberately rejected.

## Recorded validation

- Successor local suite: 13 passed, including 1,024 fuzz runs of delta conservation.
  Mixed V2/V3 vault deposits, partial/final withdrawals and paused in-kind exits passed.
- Current-state watchlist fork at block 68590305: 19 passed, 1 failed (QUOTRON).
  Each case spends 0.001 ETH and sells all acquired tokens; quote-derived 97% floors
  and residual checks are execution diagnostics, not independent NAV protection.
- QUOTRON dedicated-router fork at block 68594108: passed. Contract purchase,
  executor/vault-like transfers, immediate full sale, zero token residue and zero
  remaining router allowance were checked. Initial quotes are discovered inside
  reverted snapshots, then trades repeat with 97% quote-derived floors.
  This diagnostic does not integrate that router into HoodxExecutorV3.

QUOTRON token: 0x5a86828efd322bfb16d93cfed16ee9bc14940d7f.
Its hook requires router 0x42024fcfdb4f3089dd619a0cef0cd24e7b841c18;
the generic router/quoter fails with NotRouter (0x91655201).
Verified router source was inspected through Sourcify. The diagnostic read a 300 bps
fee and returned 940899999999999 wei from 1000000000000000 wei, before gas.
Fee and transfer restrictions can change; one successful snapshot is not a guarantee.

Earlier PRISM and NET V2 attempts failed exact-output settlement due to transfer tax.
Their alternative V4 routes passed in the 19-token run. Preserve those rejection
checks; do not treat V2 pair presence as compatibility.

## Required before release

1. Complete release review of the constrained QUOTRON and taxed-pair integrations,
   including external mutable behavior and economic limits. Implementation and local
   safety tests are now present; independent valuation remains a separate gate.
2. Independent valuation for PRISM, NET, ZEAL, Aria, HARMONIC and PROMETHEUS:
   the discovery had no usable V3 history for these. Quotes/DEX market caps are not NAV.
3. Review hook and token proxy/dependency upgrade risks; runtime code hashes alone
   do not protect against implementation upgrades or mutable fee/transfer rules.
4. Confirm token identities, especially QUOTIENT, ZEAL and Aria, against curator intent.
5. Full basket accounting, multiple trade sizes, partial/final and in-kind withdrawals,
   adversarial/invariant checks, economic gas analysis and separate canaries.
6. User-facing admission workflow and explicit compatibility/fee explanations.

No live policy approval, asset migration or old-vault unwind is authorized by this
development checkpoint. Existing holders remain in existing vaults.

## ETH-only and fee-aware development (September 21)

The user explicitly chose ETH-only entry, waiting for validated independent price
sources instead of adding proportional basket entry. The user subsequently clarified
that known swap fees and transfer taxes must be accommodated separately from price
slippage. These are successor-only changes; the V2 source and live vaults are unchanged.

- `HoodxRoutingV3` adds the fixed QUOTRON router and a direct taxed V2/WETH route.
  Kind 6 sends input directly from the caller to the canonical pair and sends output
  directly back. It checks actual input/output balances, immutable-route tax limits,
  the caller's net minimum, donor balances and complete rollback on excessive tax.
  It is not generic fee-on-transfer support for arbitrary V3/V4 routers or rebasing tokens.
- `HoodxFeeModelV3` separates modeled route costs from the additional 3% price allowance.
  Standard pool fees compound; the known Pons hook uses frozen per-pool terms;
  QUOTRON reads the actual executor's hook fee; kind 6 accounts for one taxed token
  movement plus the V2 pool fee. Unknown hook/dynamic-fee models fail closed.
  Combined modeled costs above 20% are rejected. The tax cap is part of the approved
  route; it is a disclosed maximum, not a claim that arbitrary token taxes are immutable.
- `HoodxIndexV3` now contains a separate copy of the V2 accounting with fee-aware
  execution floors and previews. It never discounts the NAV oracle itself. Taxed
  in-kind payouts clear gross reserves only after the vault debits exactly that amount
  and the recipient receives at least the configured net amount. Claim event amounts
  remain gross debits. Rebases, extra sender debits and unmodeled tax behavior remain
  unsupported. Setting no fee model preserves the original conservative floors.

Taxed-asset vault tests cover deposit, partial/final ETH exit and in-kind claims using
a token that taxes every transfer by 3%. Additional tests reject tax increases and
router output lies, and check approvals and retained balances. Existing accounting
invariants have also been ported to the new V3 implementation with the fee model off;
these are not a claim of stateful coverage of every external tax/hook mechanism.

At block 68602239, 57 generic-route round trips passed (19 tokens, each at 0.0001,
0.001 and 0.005 ETH). QUOTRON's three generic-router cases remained failures;
the dedicated path has separate tests. These remain execution tests, not whole-basket
oracle-protected release certification.

At block 68610469, the bounded pricing recheck still found no usable historical V3
candidate for all six previously blocked tokens. See `successor-pricing-status.json`.
Missing validated valuations cannot be repaired by fee deductions. Full production
readiness still requires price agreement, economic-depth review, token identity review,
full current-state basket tests, UI integration and canaries. No live deployment is ready.

### Dedicated and taxed fork at block 68610884

- PRISM direct taxed V2 round trip passed: 0.001 ETH in, 197.911735442206387088 PRISM
  received, 0.000935263670034657 ETH returned after selling all of it. No dispatcher
  token/WETH residue remained. This is execution capability, not approved NAV pricing.
- QUOTRON direct-router and integrated-dispatcher quote-based round trips passed.
  The integrated round trip returned 0.000940899999999999 ETH from 0.001 ETH.
- QUOTRON's independent-price gate failed even after deducting its 3% hook fee before
  the additional 3% price allowance. Required buy output: 1100069952046067 token units;
  quote-based buy minimum: 525712573140761 units. The V3 reference remains unsuitable
  for this execution pool until the disagreement is resolved. Fees do not explain it.

The generic QUOTRON failures remain visible in their diagnostic suite; they are not
hidden or relabeled as successful integration tests.

## Source-liveness investigation at block 68903983

QUOTRON's two WETH V3 references had observation ages of 2,168,562 and 2,181,035
seconds (about 25 days). They still returned extrapolated TWAP values. Their spot
ratios were approximately 0.8553 and 0.8410 WETH per raw token ratio, versus 1.7601
in the active V4 pool. They must not be admitted merely because `observe` succeeds.

`HoodxFreshTwapV3` adds a maximum observation age to a separately reviewed
`HoodxTwapV2` reference and its bridge, retaining the underlying time-window and
historical-depth checks. Eight local tests passed, including stale bridge/source,
uint32 timestamp wrap, code replacement and propagation of underlying depth failure.
The age limit cannot exceed the underlying TWAP window. Recent observations alone
still do not prove economic price quality or actual trading activity.

PRISM and ZEAL had recent V3 observations (39 and 10 seconds old), but each had
current/next observation cardinality 1. Increasing capacity is a potential path to
obtaining real history, not proof that the resulting oracle is safe. Separate V2
cumulative-price diagnostics for PRISM and NET produced 30-minute candidates; those
endpoint reads do not prove historical liquidity depth and are not approved feeds.

### Prepared maintenance, not broadcast

`prepared-price-history.json` contains two unsigned, zero-value calls to the canonical
PRISM/WETH and ZEAL/WETH V3 pools to increase capacity to 128. At block 68907837:
each estimate was 2,876,941 gas; combined estimated cost was 0.00029551937952 ETH.
The proposed 20% gas margin and doubled fee cap give a combined budget of
0.0007092466752 ETH. The designated curator wallet had sufficient balance at this
check. All numbers require refresh before signing.

A 2048-slot estimate exceeded the node's simulation gas allowance; its oversized
fork run was stopped and is not counted as successful. The smaller 128-slot calls
passed both estimates and fork tests. Capacity 128 does not guarantee 30-minute
retention under every activity rate. Admission still requires actual successful
30-minute observations, freshness, historical depth and price/execution agreement;
the oracle window has not been shortened.

At block 68908112 all three source tests passed: PRISM and ZEAL capacity expansion
preserved spot price, observation index and active liquidity, and the new guard
rejected QUOTRON's actual stale reference. Expanding capacity did not immediately
make missing history available. The two live calls require separate user approval
and wallet signatures. No production deployment, vault change or asset migration is
part of these calls.
