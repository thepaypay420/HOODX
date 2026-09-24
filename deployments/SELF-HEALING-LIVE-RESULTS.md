# Self-healing V2 live activation

Activated on Robinhood Chain (4663) on 2026-09-24.

## Reviewed controllers

- 696X: `0x32d806935f5118a60bB90137e699B81a0348e643`
- FAANGX: `0xB0Db61D7AeE1714A285e52f92a7b971bf28bc783`
- Curator: `0x134D468B0bcaeA6DF127916f951F7938c06A37C6`
- Reviewed build: `0x01a716ad159729482bb0156c0190c6781573b5b39893c7154e7a04325de98140`

Both deployed runtime hashes matched `deployments/self-healing-v2-reviewed.json` before activation. Deployment did not move assets or authority. The four curator calls then nominated and activated each replacement controller and approved the complete reviewed recovery set.

## Transactions

- Deploy 696X controller: `0x1b8efd97dd9427250f73358b797938adf43c85724306b06e5fd11486752119e9`
- Deploy FAANGX controller: `0xbecbf166c5d5c177ac4e5de3620ceb64e04d34258016842e489181da1b8a34db`
- Nominate 696X controller: `0x6b331eec6653948ef949120695f73cd3f2dcea860c94a2ed83ed678c802d675a`
- Activate 696X controller and recovery set: `0x098503f6b0f5e370799bcad30e3a42655198753cebe1ad75cfcc2ee20e054fae`
- Nominate FAANGX controller: `0x6a8406820ac42c6f373916a2805be6f35719f2b3af7897405db7b379d5463810`
- Activate FAANGX controller and recovery set: `0xeed6c287395bacf25a69fbe5889df4c0c2b092209529d66f52c1cb2511a6ce14`

Total deployment fee: `0.00022555086114 ETH`.
Total activation fee: `0.000100847569696 ETH`.
Combined fee: `0.000326398430836 ETH`.

## Post-activation verification

- Both vault owners are their reviewed controller addresses.
- Both vault pending owners are zero.
- Every current configuration and each reviewed historical recovery configuration is approved.
- Fresh current-chain fork rehearsals passed for both live vaults: failed-current-route healing followed by a complete ETH withdrawal.
- The complete local contract suite passed: 233 tests, zero failures.
- Independent security re-audit reported no remaining concrete finding.
