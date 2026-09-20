# Routing verification update

Latest-state fork: block 67586616, chain 4663.
All 21 RouterForkV2Test tests passed: all ten historical 696X constituents and all five FAANGX constituents bought and sold; larger-size baskets, repeated USDG routes with no executor/router dust increase, atomic minimum-output failure, and an actual return-delta hook pool.
Pinned block 67565367: prior twenty non-hook cases passed and corrected hook fixture independently passed.

These are local fork transactions, not live canary transactions. Route execution success does not approve valuation references or authorize production release. The hook was allowlisted only inside the capability test; this is not production hook approval.
No deployment or fund sweep has been broadcast.

Exact pinned configuration: both official normal round trips also passed at latest tested block 67610605 and fixed block 67591644. Stress block 67565367 verifies protected failure plus direct recovery; it is not a normal-canary pass.
