# HUNTX V3 breakthrough study

**Research snapshot:** 29 September 2026  
**Status:** prototype and bounded backtest complete; no live deployment or funding authorized

## Result

The larger-position design is now evidence-led rather than a scaled version of the rare-winner V2 rule.

The new rule waits for a launch to survive, then buys the first strong one-hour recovery after a meaningful six-hour pullback. It closes quickly instead of holding a launch token for a day:

- decision window: 12–48 hours after the candidate is armed;
- six-hour drawdown: at least 10%;
- one-hour momentum: positive;
- six-hour volume: 5–100 WETH;
- executable size: $20 must be no more than 0.25% of six-hour volume and no larger than one observed median swap;
- selection: strongest recovery first, one token per creator cluster, maximum two entries per day;
- position: exactly 10% of initial NAV, or $20 in the $200 pilot;
- maximum launch exposure: 20%;
- exit: +20% take-profit, -15% oracle stop, or four-hour timeout;
- activity: two buys and two exits on a fully active day.

This rejects the earlier assumption that more raw volume should rank first. Across the eligible population, raw volume and short-horizon volatility were negatively associated with forward return. Recovery strength after a pullback was more useful.

## Calendar holdout

The bounded study tested 1,620 declared rules over 1,036 hourly snapshots from 50 security-gated PONS pools. The first two calendar cohorts selected the rule. The later two cohorts were held out and were not used to change it.

At a 10% NAV position size and **5% round-trip friction**:

- training: four trades, all reached the capped target; +5.60% portfolio contribution;
- holdout: four trades, three targets and one gap loss; +2.21% portfolio contribution;
- holdout worst day: -0.59% of NAV;
- all eight trades: +7.81% of NAV across four non-consecutive cohort days.

At an intentionally severe **8% round-trip friction**:

- training contribution: +4.16%;
- holdout contribution: +0.88%;
- holdout worst day: -1.20%;
- all eight trades: +5.04% of NAV.

The 43x token that dominated the earlier survivor study is not allowed to dominate this result. Every winning trade is capped at the 20% take-profit. Stop losses use the observed bar price rather than assuming a fill at the trigger, so the losing trade includes its gap.

## Capital structure

HUNTX V3 is a barbell:

- 80% in the three independently reviewed PONS v1 fee sleeves;
- 20% WETH working capital for two simultaneous $20 launch trades.

With equal weights across the three fee sleeves, the historical base sleeve alone modeled +0.40%, +9.95%, and +11.54% in its three disjoint evaluation weeks. Those weeks do not align with the launch cohorts, so the LP and launch returns are reported separately and are not added together.

The 20% WETH is working capital, not a return target. Putting it in another LP between short signals would add an LP exit, stable conversion, gas and timing risk to every $20 launch trade. At pilot scale that can erase the edge. The correct optimization is for the other 80% to earn, while the 20% remains immediately executable.

## Contract prototype

`HoodxLaunchHunterV3` encodes the tested limits:

- exactly 10% per launch;
- two active positions and two entries per day;
- 12-hour minimum observation and 48-hour entry expiry;
- public +20%, -15%, and four-hour exits;
- a separate immutable 20% WETH seed and 100% NAV risk reference;
- one to four reviewed base-sleeve tokens that must be funded before bootstrap;
- direct in-kind recovery of WETH, every base sleeve and every active launch token;
- a 97% oracle execution floor that public exit callers cannot weaken.

The prototype remains a closed, protocol-funded pilot. It has no public deposit path.

## What this does and does not prove

This is the first HUNTX rule in the current archive sample that stayed positive in the held-out cohorts after high friction while using economically meaningful $20 positions. It is still only eight trades across four cohort days. It does not support an APR or APY claim.

Deployment remains blocked until the frozen rule has at least 30 later calendar days, 30 completed trades, exact per-token PONS fee and creator-tax reconstruction, $20 buy/sell fork replay, and a lower confidence bound that remains above zero after gas and failed exits.

## Reproducible evidence

- `research/launch_hunter_v3_breakthrough_study.py`
- `research/launch_hunter_multicohort_results/launch_hunter_v3_breakthrough.json`
- `research/launch_hunter_multicohort_results/launch_hunter_v3_recommended_trades.csv`
- `contracts/launch/HoodxLaunchHunterV3.sol`
- `test/launch/LaunchHunterV3.t.sol`
