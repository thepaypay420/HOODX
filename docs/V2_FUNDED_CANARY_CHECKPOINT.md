# Funded canary preflight — 2026-09-20 UTC

Status: blocked before broadcast by the live-market intended-purchase gate. This is not a successful live-canary report.

## Confirmed

- Chain ID: 4663.
- Deployer: 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19.
- Funded balance at the initial check: 0.115 ETH; outgoing nonce: zero.
- Encrypted keystore offline message signing and independent signature recovery: passed. No key or password was exported. The proof is an explicitly non-transactional, nonce-bearing message.
- User explicitly enabled HOODX_LIVE_BROADCAST=1 for canaries only and confirmed availability to sign curator calls. This authorization persists; it does not enable production.
- Final unsigned deployment simulation: passed at block 67658057. Estimated deployment gas 48,921,560; max-fee quote 0.126048001 gwei; estimated cost 0.00616646484380156 ETH.
- Reviewed build fingerprint remains 0xe7388911d0a7cb3c1fef4b8555d060a05782b7ada1dd18e5494ba3857bbc9138.
- Production contracts and architecture have not changed in this continuation.

## Blocking evidence

The expanded full-cycle fork rehearsal fails at both blocks 67661344 and 67662679: `intended buy deferred: 0 <= 0` during the first 696X deposit.

The trace at 67661344 identifies token 0x18E674231A58c239Dc7DaeDcffE15Ec3A24cff5c. A 0.00510236 ETH allocation produced 1,066,370,352,414,231,170,101 raw token units against a minimum of 1,105,743,084,257,040,838,556. The executor reverted InvalidAmount and the vault retained that allocation as cash, emitting BuyDeferred. The live canary requires every intended purchase, so this fails the gate even though retaining cash is supported deposit behavior. The protected minimum is unchanged.

The same expanded rehearsal passed on recorded stable block 67591644, covering both configurations: deposit, curator pause, rejected deposit while paused, small curator unwind with no curator asset payout, 1% in-kind redemption, liquidation of the returned constituents back to WETH/ETH, normal partial/final withdrawals while paused, and zero final vault balances. Historical success cannot replace a passing current preflight.

## Prepared execution and evidence tools

CanaryStepV2 and the canary-step runner separate deposits, partial/final withdrawals, 1% in-kind redemptions and explicit constituent recovery. Each action binds the actual factory, vault, basket, expected share state, curator roles, chain and build. These allow actual receipt and balance checks between actions rather than submitting both baskets as one unattended sequence.

The canary-only session guard rejects the production runner before RPC/signing. Its broadcast fee cap is 0.26 gwei. The human-terminal helper accepts only canary deployment or canary-step actions, uses the named encrypted account, and takes the password only at the hidden prompt. It has not been launched for live signing.

inspect_v2_canary.py prepares pinned-block role, constituent, route, oracle, metadata, claim, reserve, vault/quote/router/executor balance and actual canonical-receipt evidence. It requires real deployed addresses. It has not yet run against live V2 canaries because none exist; its output alone does not certify source equivalence, finality or full historical success. The original six-transaction receipt checklist must be supplemented with the explicit pause, unwind, in-kind and token-recovery receipts for this expanded cycle.

## Funding update

For the canary-only scope, reserve 0.08 ETH peak sequential capital and a conservative 110,000,000 total deployer-gas allowance, including the one stack, normal cycles, in-kind transactions, constituent approvals/sales/revocations and recovery overhead. At the enforced 0.26 gwei cap this is 0.0286 ETH gas, for 0.1086 ETH total and 0.0064 ETH remaining planning headroom from the 0.115 ETH balance. This allowance is intentionally larger than the measured deployment and cycle costs; every actual step still requires its current unsigned simulation before signing. Curator wallet gas is separate and must be confirmed when preparing curator calls.

There is no immediate broadcast while the market gate fails. Refresh balance, fees, exact deployment estimate and full current fork again once the purchase becomes executable; do not describe this blocked-run estimate as an immediately-before-broadcast approval.

## Validation and next boundary

- New script/tests compile; formatter check passes.
- Python suite: 110 passed, one existing skip.
- Canary-only production-block check: passed before wallet/RPC access.
- Expanded stable-fork rehearsal: passed.
- Expanded latest-fork rehearsal: failed twice as described above; no thresholds were relaxed.

Live canary deployment hashes: none. Live smoke hashes: none. Production deployment hashes: none. No live broadcast occurred. Do not start FAANGX before 696X is recovered and verified. Stop after successful live canaries and report receipts and remaining deployer ETH; production remains prohibited by the user's current instruction.
