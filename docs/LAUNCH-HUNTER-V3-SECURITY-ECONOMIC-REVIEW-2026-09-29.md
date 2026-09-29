# HUNTX V3 security and economic review

**Review date:** 29 September 2026  
**Scope:** undeployed `HoodxLaunchHunterV3` prototype and its bounded research model

## Security result

This prototype review is superseded for deployment readiness by [HUNTX-V3-PRODUCTION-AUDIT-2026-09-29.md](./HUNTX-V3-PRODUCTION-AUDIT-2026-09-29.md). The production pass added the exact FEEX base, authenticated deployment tooling, atomic backing, tracked candidate recovery, and current-fork execution evidence. Candidate routes remain deliberately deferred until each asset is separately reviewed and armed.

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

The refined tactical sleeve uses two 10% positions, a +50% oracle take-profit, a -20% oracle stop and a four-hour maximum hold. Exit selection used only the first two cohort dates on a coarse operational grid. The later two dates were then reported unchanged. The replay checks intrabar highs and lows, treats an unknowable same-bar stop/target ordering as a stop, caps favorable execution at the target, and charges delayed downside at the later observed close.

At 5% round-trip friction and immediate execution, the held-out sample contributed +14.80% of total NAV, with a +6.30% worst held-out day. At 8% friction plus a 15-minute delayed close fill, it contributed +12.06%, with a +4.46% worst held-out day. All four held-out trades remained profitable in those scenarios. At 12% friction, a target win nets 32% and a stopped trade loses 29.6%, so the after-cost reward/risk falls to 1.08:1 and requires a 48.1% win rate to break even.

The nominal +50%/-20% ratio is 2.5:1. After 5% assumed round-trip friction it is 1.77:1, with a 36.1% break-even win rate. This is the center of a profitable +40% to +55% target and -20% to -22% stop neighborhood. A superficially stronger +55%/-18% fine-grid result was rejected: the stop sat only 2.3 percentage points beyond an observed -15.7% adverse excursion and produced a negative held-out day. The stop is a trigger, not a guaranteed fill, and the 10% position cap remains the primary loss control.

The research does not establish an annual return. Four non-consecutive observation days cannot be annualized responsibly. The calendar holdout is mechanically excluded from selection in the script, but prior V3 work had already inspected those dates, so fresh confirmatory data is still required. A displayed APR remains prohibited until the later-data promotion gates pass.

## Remaining launch blockers

- **UNVERIFIED:** exact $20 buy and sell against every proposed live route, including creator tax, PONS fee, price impact and gas;
- **RESOLVED FOR THE CLOSED PILOT:** exact four-sleeve FEEX backing and two-layer recovery passed on a current local fork; future candidate routes remain separately gated.
- **UNVERIFIED:** oracle resistance during the four-hour exit window and agreement with executable route value;
- **UNVERIFIED:** token-specific blacklist, transfer-tax, mutable-code, mint and confiscation behavior;
- **UNVERIFIED:** at least 30 later calendar days and 30 completed frozen-rule trades; the current exit evidence is eight trades across four non-consecutive days;
- **UNVERIFIED:** deployment launcher, source fingerprint, role wiring, bootstrap amounts and production UI;
- independent contract review is still required before any signing flow is produced.

No production transaction was created or broadcast by this work.
