# Atomic rebalance controller live results

Verified on Robinhood Chain 4663 on 2026-09-24.

## Deployment

- Reviewed controller build: `0xbfd17fb8967d8e4fefc8884e231f457a0a1316455bde4b1031f8ff24d49e517a`
- 696X controller: `0x5A732854bD6A4EEa6e5bA9ED9D897bC089f58767`
  - deployment transaction: `0x60b43a15341a78cbc1ba5496a273119b2c7e7de2307580006de7948ad6fc22a7`
- FAANGX controller: `0xB5bCe75EB8761BF084F1abC71650b88311C9f4fb`
  - deployment transaction: `0x430a31e954efcd15ab2921ad8af329cbc3f608679534b2fbbb00d6178ad62c5c`
- Exact combined deployment fee: `0.000167424137272 ETH`, below the approved `0.000500 ETH` maximum.

## Curator activation

- 696X nominate: `0x599771fcafe8c807556aefbf8eaf5404272924c185c409605415be9b053ae72d`
- 696X activate: `0x2b0fd67d2ef3c73053fb4b7354938f7f15493e0ac7ca7dc59c40228bcc8f2bfd`
- FAANGX nominate: `0x6eb9cebe63123e60731955e3b1a9936e88b2c9ea287aa097ce1428648a6ab74c`
- FAANGX activate: `0x98757854b937083efdd784771ae3ef96929664a30b08e27ae596c750cd576786`
- Exact combined activation fee: `0.000008984165190 ETH`.

## Final verification

- Each vault owner is its exact controller and each `pendingOwner` is zero.
- Each controller points to its intended vault and pins curator `0x134D468B0bcaeA6DF127916f951F7938c06A37C6`.
- Both controllers hold zero native ETH.
- Balance checks covered all 10 696X constituents, all 5 FAANGX constituents, and each vault's WETH. Every controller token balance was zero.
- Activation transactions were zero-value ownership calls. No rebalance, approval, withdrawal, or vault asset transfer was executed.
- A live portfolio rebalance remains a separate operation requiring fresh quotes, a complete simulation, and an explicit curator wallet signature.
