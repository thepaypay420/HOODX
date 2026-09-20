Historical checkpoint: implementation and tool-status statements below are superseded by V2_SECURITY.md and V2_DEPLOYMENT.md.

# V2 investigation checkpoint — incomplete, no release approval

Baseline: 8cba460. Working branch: codex/hoodx-v2-hardening.
No Solidity, frontend configuration, or deployed contract has been changed.

## Confirmed source findings

- HoodxIndex._liquidate (lines 653–667) skips a non-liquidatable constituent, a zero oracle floor, or a caught failed swap. withdraw subsequently burns all requested shares if aggregate available proceeds satisfy its checks. Thus a cash-bearing withdrawal can destroy the claim on unsold constituents. A failed whole transaction reverts; the defect is a successful partial liquidation followed by a full share burn.
- _canLiquidate checks binding/hook state, not successful sell execution. redeemableAssets and previewSell therefore do not establish actual liquidation capability.
- withdraw calls _assertPriced, totalAssets, and _snapshotPx. Ignoring the pause flag alone does not make withdrawals oracle independent.
- _swapQuotedSell bridges the entire vault quote balance with bridge minimum output 1. This can mix pre-existing quote holdings with one shareholder's proceeds. Its minWethOut parameter is not used inside that function; inspect the caller's checks before assigning final exploit severity.
- _nav enumerates constituents plus WETH/native ETH, not all configured quote balances. Successful route residuals can consequently be outside the reported NAV.
- removeToken and rebindToken require a zero token balance. An unsellable holding therefore prevents these ordinary repair paths.
- _bindV4 rejects every nonzero hook. V4 settlement uses delegatecall into bespoke PoolManager unlock/swap/sync/settle/take code with empty hookData.
- Dust claims require curator stranding and a remaining share balance. They are not an unconditional shareholder escape hatch.
- Factory creation assigns creator from msg.sender; initialization also assigns owner to that creator. A disposable deployer cannot safely use the old creation flow and assume economic rights move with curator ownership.
- README/DESIGN/QUOTE_BIND retain older deployment references than deployed.json and lib/config.ts. Records are evidence, not proof of current chain state.

## Historical evidence inspected

Recent history includes 30989c2 (FAANGX exit), 127be3c (stranded balances), 14ab416 (USDG dust), d3fbe39 (canonical FAANGX), and 8f19212 (dust claims).
The requested recovery/deployment scripts contain external other-bot wallet dependencies. They were searched/read as source only; none were executed.
create_faangx.py documents thin AMZN/NFLX WETH pools and selection of V4/USDG alternatives. recover_old_faangx.py documents immutable old swap logic, failed sells, and unavailable stranding for those hookless pools. extract_via_lp.py and RescueTok implement a curator-owned-liquidity extraction workaround, unsuitable for V2 shareholder recovery.

## Proposed design constraints — not yet a finalized architecture

1. All required normal sells must succeed atomically, or the withdrawal reverts with shares and asset balances unchanged.
2. In-kind redemption must not consult the router, oracle, pause flag, or curator. Its asset registry must retain every economically owned constituent and configured residual currency until balances and outstanding claims are zero.
3. A token itself can blacklist or reject transfers; no vault can override that. Evaluate per-asset claim accounting so one failed token transfer cannot block recovery of every other asset. Preserve the failed asset claim; never silently discard it.
4. Prefer a non-custodial executor with typed, bounded routes and internally constructed canonical router commands. Check actual input/output balance deltas, exact approvals, fixed recipient, full residual handling, and cross-vault isolation. No arbitrary target or asset-moving delegatecall.
5. Keep valuation independent of execution. V4 spot plus a last-price snapshot is not a sufficient general oracle guarantee. Restrict assets without a justified valuation source.
6. Buy failures may retain the authorized allocation in WETH; sell failures cannot consume shares. Catch failures only across a fully reverting trade boundary.
7. Creation must take explicit curator, creator, fee recipient, treasury, and factory authority. Canary and production must use identical compiled code with separately recorded configuration.
8. Do not finalize the share formula, route encoding, supported hooks, or official baskets until the remaining source and live-chain investigation is complete.

## External sources

Uniswap's SDK constants and supported-chain documentation list Robinhood 4663 router 0x8876789976decbfcbbbe364623c63652db8c0904 as V2_1_1:
- https://github.com/Uniswap/sdks/blob/main/sdks/universal-router-sdk/src/utils/constants.ts
- https://developers.uniswap.org/docs/trading/swapping-api/supported-chains
These listings do not constitute deployed-bytecode or permissioned-pool verification.

## Validation and boundaries

Executed: python -m unittest discover -s tests.
Result: 111 tests, 109 passed, 1 failure, 1 skipped. Failure: test_ui_rejects_thin_and_hooked_in_plain_language; expected wording does not match source. These are existing tests, not a V2 security suite.
Executed: git diff --check (passed before this document was added).
Not run: Foundry, fork tests, frontend tests/build, static analysis, canary, production.

Session setup: ROBINHOOD_RPC_URL absent; HOODX_LIVE_BROADCAST not enabled; forge/cast not on PATH; named deployer keystore absent at the checked default path. GitHub connector read access works; gh reports invalid GH_TOKEN. Git clone succeeded using Windows certificate validation (schannel); TLS verification was not disabled.

Live old-vault balances, share supplies, pool keys, hooks, code hashes, role assignments, deployer address, balance, and funding estimate remain UNVERIFIED. No token is classified V2-supported. No broadcast occurred.

Next required input: privately configure ROBINHOOD_RPC_URL in the execution environment. Never paste the endpoint, private keys, or keystore password into chat. Encrypted keystore creation must use a human-controlled hidden password prompt after Foundry is available. Do not create a plaintext wallet as a fallback. Keep live broadcasting disabled until local/fork gates and the required signing/funding checkpoints are satisfied.
