# HUNTX V3 security and economic review

**Review date:** 29 September 2026  
**Scope:** undeployed `HoodxLaunchHunterV3` prototype and its bounded research model

## Security result

No critical or high issue was found in the tested prototype paths. The contract is not cleared for deployment because exact live base sleeves, candidate routes, PONS fees and fork execution have not yet been supplied.

The principal safety properties are:

- the pilot has no public deposit function;
- launch size is fixed at 10% of the immutable initial NAV reference;
- at most two positions and 20% launch exposure can be active;
- donations and profits cannot expand the immutable launch-risk budget;
- entries expire after 48 hours and runtime bytecode must still match the armed candidate;
- creator clusters cannot overlap;
- route configuration is append-only policy data and both directions are validated when armed;
- public exits cannot lower the contract's independent 97% oracle floor;
- pausing new risk does not pause timed recovery;
- a failed protected exit reverts atomically and can be retried;
- direct redemption does not call a pool, router, oracle, scanner or backend;
- WETH, base sleeves and launch tokens are reserved and transferred independently, so one failed token transfer does not roll back unrelated recovery;
- base sleeve backing cannot be removed with the unexpected-token rescue function.

Fourteen focused tests cover bootstrap backing, exact sizing, risk and entry limits, spacing, observation expiry, profit/stop/timeout exits, public-exit protection, failed-exit retry, pause recovery, base-backing rescue rejection, and direct recovery.

## Economic result

The tested tactical sleeve uses two 10% positions and caps every winner at +20%. At 5% round-trip friction, the later untouched cohorts contributed +2.21% of total NAV and the worst held-out day was -0.59%. At 8% friction they contributed +0.88%, with a -1.20% worst day.

The one losing held-out trade fell through its -15% trigger and realized -19.91% after 5% friction. This is why the contract limits the position to 10% of NAV and uses the observed exit rather than presenting the stop as guaranteed.

The research does not establish an annual return. Four non-consecutive observation days cannot be annualized responsibly. A displayed APR remains prohibited until the later-data promotion gates pass.

## Remaining launch blockers

- **UNVERIFIED:** exact $20 buy and sell against every proposed live route, including creator tax, PONS fee, price impact and gas;
- **UNVERIFIED:** exact three base-sleeve contracts, balances, fee ownership and complete unwind on a current local fork;
- **UNVERIFIED:** oracle resistance during the four-hour exit window and agreement with executable route value;
- **UNVERIFIED:** token-specific blacklist, transfer-tax, mutable-code, mint and confiscation behavior;
- **UNVERIFIED:** at least 30 later calendar days and 30 completed frozen-rule trades;
- **UNVERIFIED:** deployment launcher, source fingerprint, role wiring, bootstrap amounts and production UI;
- independent contract review is still required before any signing flow is produced.

No production transaction was created or broadcast by this work.
