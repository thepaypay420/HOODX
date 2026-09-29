# HUNTX V3 exit and reward/risk study

The recommended pilot setting is a **+50% take-profit, -20% stop and four-hour maximum hold**. Its nominal reward/risk is 2.5:1. It replaces the earlier +20%/-15% prototype setting, which cut the launch-recovery pattern too early and stopped a trade that later cleared the profit region.

The entry rule, position size and eight selected trades were frozen. Exit parameters were selected on 13 and 15 September only; 17 and 20 September were held out. The study uses 15-minute high/low barriers, assumes the stop occurs first if both barriers appear in one bar, caps favorable fills at the target, and charges 15- and 30-minute delayed fills at the later close. Local parameter perturbations were retained as sensitivity checks rather than eligible fine-tuning choices.

At 5% friction with immediate execution, the two training dates contributed 17.00% of total NAV and the two calendar-holdout dates contributed 14.80%. The holdout worst day was +6.30%. At 8% friction and a 15-minute delay, the corresponding results were +14.54% and +12.06%, with a +4.46% holdout worst day. The eight observed trades had no intrabar ambiguous target/stop bars under this setting. These later dates are a mechanical holdout in the script, but earlier V3 work had already inspected them; they are not pristine confirmatory evidence.

After-cost economics for one launch position are:

- 5% friction: +42.5% target win, -24.0% stopped loss, 1.77:1 reward/risk, 36.1% break-even win rate;
- 8% friction: +38.0%, -26.4%, 1.44:1, 41.0% break-even;
- 10% friction: +35.0%, -28.0%, 1.25:1, 44.4% break-even;
- 12% friction: +32.0%, -29.6%, 1.08:1, 48.1% break-even.

This is the best **observed robust pilot setting**, not a proven global optimum. Eight trades cannot validate the stop-loss tail or support an APR. Promotion still requires at least 30 later calendar days, 30 completed frozen-rule trades, exact token tax reconstruction and current-fork route execution.

Reproducible artifacts:

- `research/launch_hunter_v3_exit_study.py`
- `research/launch_hunter_multicohort_results/launch_hunter_v3_exit_grid.csv`
- `research/launch_hunter_multicohort_results/launch_hunter_v3_exit_details.csv`
- `research/launch_hunter_multicohort_results/launch_hunter_v3_exit_recommendation.json`
