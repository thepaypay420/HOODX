# Successor canary infrastructure live checkpoint

Broadcast and independently verified 2026-09-23 on Robinhood Chain 4663. This checkpoint contains infrastructure and two inactive delayed hook proposals only. No route is approved, no vault exists, no canary capital moved, and production remains disabled.

## Contracts

- Hook registry: `0xa46150E972Da054f9b954D7a695476A6258A4705`
- Executor: `0xB45AC99C355898EAcb3CDFF2c0b94F6C9a77a750`
- Routing: `0x0d96E749dc6eBd4Ec9E4f35BB3fa05Ab89f1C0dE`
- Fee model: `0xE274bc33C5dCD3Ee1dd603a3e08509E46c2B3dFb`
- Policy: `0x93E3d62d50eAfAD5d5dE38c55Da33CC9dB839b21`
- Implementation: `0xDDC4084055Ae4d56f9Fa618A1Ccd962737F1aEf7`
- Factory: `0xb0a89074d2f88207698aC99f39061463eeabeC8a`

Every deployed address has code with the expected reviewed runtime size. Constructor dependency getters, implementation accounting identity, registry/policy/factory owners, factory treasury and implementation were read back and matched the signing plan. The reserved `696x` and `faangx` factory slugs both return the zero address.

## Transactions

1. Registry: `0x26d6dbba8d5f025b9fb99c585c3cba3751a2b569d416e39686e9ce2acdfbc1c8`
2. Propose PONS hook: `0x267ca962ba7dc9ccdc7b49092c60c40eefed2fe8d0570c6df0c1456879146c6f`
3. Propose QUOTRON hook: `0x27409962e6714ec2a435a39fb256e079031a904850cc4d2b221c8fb0d634be74`
4. Executor: `0x0faee118343cacda25c94b14eff361b5ec83092b822d2dce9bd9b7a480aeebff`
5. Routing: `0xba6affff2ed4c7ed41dba95cda160f3c0c10a9da1a09ba3ac0ed7062ee7ff994`
6. Fee model: `0x45de43930d1b64e701c82f3319acaf346c01ab996f67f5c2dba8da55c04cf4bf`
7. Policy: `0xa039e62624dc93c3f1d9bc8427cd77bc55dca948b980fb3c2fe895354d0c9763`
8. Implementation: `0x5cf859615cbb78cbe22dc8f8c6f3aaf55dfa25b611909588005eb888bcd8f3dc`
9. Factory: `0xa4da45e18ffab6f5b7be8fca6d90b9f27fc387b0c56c493e429083b06f67c1c0`

All nine receipts have status 1. Nonce advanced without a gap from 90 through 98; latest and pending nonce are 99.

## Hook delay and cost

- Review evidence: `0x6b70f4f761e22ecca3a35aab6a9ba22eea9dbd038165fe684f63ca9e1a27315f`
- PONS pinned code hash: `0xc21b1e6c1b45403e81a581f22ed6d9c747997af1cfdac1b1dc9f4b1d346a10db`
- QUOTRON pinned code hash: `0xd6082651ea0016d58e52d4478b46b8ef601dce4cd6312f22f572ad39f8b2a094`
- Both hooks remain inactive.
- Both proposals become eligible at Unix timestamp 1790322086: **2026-09-25 07:41:26 UTC / 00:41:26 Pacific**.
- Mandatory delay: 172,800 seconds.
- Actual combined gas cost: **0.000727732479168 ETH**, below the approved 0.001826825005512 ETH cap.
- Remaining deployer balance: **0.049277497024832 ETH**.

Do not activate either hook before the timestamp, and do not approve routes or create a vault until the hook code/dependencies, current fork lifecycle, funding and per-stage signing envelope are refreshed.
