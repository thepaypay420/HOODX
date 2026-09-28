# Proportional canary incident — 2026-09-27

## Status

The disposable vault at `0x64C9cBBa19B6f6A6D9646b0694F668BeA2501436` is retired and must not receive another deposit. Its immutable basket contains the legacy `QUOTIENT` contract `0x013940c3daa5e2Bb12df1Ea94AfE47Ce84c0db4f`. The active token is `0x2531F3ca1b31086b7FC130eCDa6D3253DAF83ba3`.

Transaction `0x8ec7d791d86bcc7282d8e71abf34ba3d08e42b2de25c57b31431ab1a965bd425` reverted atomically. The 0.02 ETH deposit principal was not retained by the canary; the wallet paid gas for the failed transaction. No production 696X contract was changed.

## Evidence

- Both contracts return the same name and symbol, which made symbol-only discovery unsafe.
- The legacy contract's selected market had effectively no daily volume and Rabby marked the received asset as a scam token.
- The active contract's WETH pool is Uniswap v4 pool ID `0xc6c2cd8e0f1e9373e0e2c60da3b6619753f7ff05599d59a66a358cbbaecc5ccf`.
- Its exact on-chain pool key is WETH/QUOTIENT, dynamic fee `8388608`, tick spacing `200`, hook `0x4e3468951D49f2EEa976eD0D6e75fFCb44a9a544`.
- The hook runtime code hash observed at the incident block is `0xc41a91106002f15bf70ae266824317f3f3ac638ac72ca5253bae395fa47ee631`.
- The HOODX hook registry has neither a proposal nor an approval for this hook.
- Direct swaps through the corrected route passed current-chain fork tests at `0.0001`, `0.001`, and `0.005` ETH in both directions.
- The complete 21-asset `0.02` ETH lifecycle still reverts with `UnsupportedFee()`. The deployed `HoodxFeeModelV3` intentionally rejects Uniswap v4 dynamic-fee routes (`fee >= 1_000_000`). This is a separate blocker from hook admission and is the correct fail-closed behavior.
- The active QUOTIENT market therefore cannot be added safely to a vault using the currently deployed implementation and fee model. Hook approval alone would not make it compatible.

## Protection added

- The manifest pins the active token address and exact v4 pool key.
- A regression test rejects the legacy address and verifies the active pool ID.
- The repeatable identity audit rejects duplicate addresses, the blocked legacy address, symbol mismatches, inactive markets, and thin markets.
- The local signing UI now fails closed unless the replacement canary address and slug are explicitly supplied. It always rejects the retired vault.
- Historical signed envelopes and bootstrap evidence are preserved as incident evidence and are not reusable because the route fingerprint changed.
- The legacy readiness, envelope-builder, bootstrap-preparation, and wallet-launch scripts are retired and terminate before producing or presenting a transaction.
- A manifest-specific regression test proves that the deployed fee-model rules reject the active QUOTIENT dynamic-fee route.

## Required before another live transaction

1. Choose one safe path: omit QUOTIENT from this implementation, find and verify a supported fixed-fee market, or separately review and approve a new fee model and immutable implementation that can conservatively bound this exact dynamic-fee hook.
2. If the new-contract path is chosen, prove the hook's maximum effective fee, pin its runtime hash, test fee changes and failure modes, and complete a dedicated contract security review. No such contract change is approved by this report.
3. Only after the fee model supports the route, complete hook review, propose the exact hook to the existing delayed registry, and wait through the full cooldown without bypassing it.
4. After maturity, activate only the exact proposal, admit a newly reviewed route fingerprint, and create a new immutable canary under a new slug.
5. Pass bootstrap, independent participant deposit, partial ETH withdrawal, paused in-kind recovery, and final close on a current local fork at the maximum supported basket size.
6. Open the signing UI only for the exact verified replacement address after all prior checks pass.

Until all six steps pass, the replacement remains blocked from signing. The old canary may be inspected or recovered through dedicated recovery tooling, but it must never accept another deposit.
