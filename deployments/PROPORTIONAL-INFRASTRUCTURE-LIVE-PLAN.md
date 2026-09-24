# Successor canary infrastructure signing plan

Prepared 2026-09-23. **Awaiting explicit successor-canary-infrastructure broadcast authorization. Production is disabled.**

## Pinned identity and state

- Chain: Robinhood Chain, ID 4663
- Reviewed commit: `c022da1`
- Reviewed build fingerprint: `0x27617dede4a9e422f04e7d37322babd4120793027b7a6443178859d794661851`
- Review evidence preimage: `HOODX_SUCCESSOR_REVIEW:c022da1:0x27617dede4a9e422f04e7d37322babd4120793027b7a6443178859d794661851:PROPORTIONAL-SECURITY-REVIEW-2026-09-22`
- Review evidence hash: `0x6b70f4f761e22ecca3a35aab6a9ba22eea9dbd038165fe684f63ca9e1a27315f`
- Deployer: `0xf63E63a80A25611154C5d1c06E55FD763E0cfC19`
- Treasury: `0x134D468B0bcaeA6DF127916f951F7938c06A37C6`
- Refreshed fork block: 70338902
- Live nonce at rehearsal: 90 latest and pending
- Live balance at rehearsal: 0.050005229504 ETH

Any source, fingerprint, nonce, pending transaction or material fee change invalidates this envelope and requires a new rehearsal.

## Authorized stage if approved

Exactly nine deployer transactions, in order:

1. Deploy hook registry.
2. Propose the reviewed PONS hook. This starts, but cannot bypass, its 172,800-second delay.
3. Propose the reviewed QUOTRON hook. This starts, but cannot bypass, its 172,800-second delay.
4. Deploy executor.
5. Deploy routing contract.
6. Deploy fee model.
7. Deploy proportional policy.
8. Deploy proportional implementation.
9. Deploy successor factory.

This stage cannot activate hooks, approve token routes, create a canary vault, move tokens, spend canary capital, change an existing vault or deploy production.

## Spending envelope

- Exact-fork gas used: 13,364,239
- Gas limit envelope with 25% padding: 16,705,302
- Rehearsal gas price: 54,678,000 wei
- Maximum fee assumption: 109,356,000 wei per gas
- Combined stage maximum: **0.001826825005512 ETH**
- Minimum remaining balance under that full maximum: **0.048178404498488 ETH**

The remaining balance is not yet sufficient to preserve the complete 0.02 ETH bootstrap + 0.02 ETH second entry + 0.01 ETH reserve target after later approval, vault-creation and trading gas. Recalculate and top up before those later stages.

## Required receipt checks

After each transaction: require chain 4663, expected sender and nonce, successful receipt, expected contract address or proposal event, code presence, constructor dependencies and owner/treasury roles. Stop on any unknown or failed receipt. After transaction 9, verify both hook proposals are inactive and have the full delay, and verify no vault exists.
