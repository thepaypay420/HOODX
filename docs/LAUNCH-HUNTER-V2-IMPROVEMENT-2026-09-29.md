# Launch Hunter V2 — Higher-utilization candidate

**Status:** superseded before deployment by the calendar-held-out V3 pullback/recovery design. V2 remains preserved as negative-control evidence and must not be bootstrapped.

## Why V1 remains empty

The deployed V1 vault limits each launch to 0.5% of the $200 seed, roughly $1. That is an appropriate loss-bounded research canary but too small to produce useful net dollars. V1 is immutable, so its limits cannot be loosened in place. It should remain unbootstrapped while V2 is tested.

## V2 operating envelope

- Candidate size: 5% minimum and 10% maximum ($10–$20 on the pilot).
- Aggregate launch exposure: 50% maximum.
- Active candidates: five maximum, one per creator/funder cluster.
- Observation: 12 hours.
- Entry cadence: 30 minutes minimum between entries and four entries per 24-hour window.
- Expected activity in the historical sample: two candidates and four base trade actions per active cohort; principal recovery can add actions.
- Execution: every swap must remain within 3% of the oracle value and a five-minute deadline.
- Management: recover principal once a sleeve reaches 1.35x; let the runner trail by 55%; force exit at 24 hours.
- Withdrawal: proportional WETH and token recovery remains independent of routes, oracles, scanners, and the website.

## Evidence and its limit

The frozen 12-hour rule selected eight positions across four calendar cohorts. At the original 0.5% size, cohort-level vault returns were -0.327%, -0.133%, -0.325%, and +21.273%. Scaling those paths to larger positions produces attractive arithmetic but is not a forecast: one extreme winner dominates the mean, and linear scaling ignores market impact. The sizing study therefore treats 5% as the default and 10% only as a hard ceiling.

No APR is supportable. Before deployment, the eight exact routes must be replayed at $10 and $20 sizes with each launch's snapshotted PONS base fee and creator tax, real price impact, failed-sell behavior, and gas. V2 should deploy only if those larger-size fork replays preserve a positive median after all costs or produce enough new untouched observations to establish it.

## Safety decision

Higher utilization materially raises loss severity. V2 keeps the original codehash checks, cluster isolation, short deadlines, temporary approvals, permissionless timed exits, emergency curator exits, and route-independent recovery. The entry-rate budget is new: it prevents a compromised operator from cycling the whole vault rapidly while still permitting up to eight entry/exit actions per day.
