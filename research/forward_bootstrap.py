"""Cloud bootstrap for the daily forward job (GitHub Actions). Idempotent and cheap after the first run.

1. If the static inputs are missing, unpack research/forward_seed.tar.gz (built by forward_seed_build.py).
2. Fetch swap logs for the tracked pools for 2026-09-20..2026-09-29 (the history the forward books need)
   into huntx_forward/logs/<day>/, skipping days already present (the runner caches that folder).
"""
import gzip, json, sys, tarfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parent
FIRST, LAST = date(2026, 9, 20), date(2026, 9, 29)


def main() -> int:
    if not (ROOT / "huntx_edge_state_panel.json.gz").exists():
        with tarfile.open(ROOT / "forward_seed.tar.gz") as tar:
            tar.extractall(ROOT.parent, filter="data")
        print("seed unpacked", flush=True)
    import huntx_forward_shadow as F  # imported after unpacking: module-level paths must exist

    bounds = dict(json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())["day_bounds"])
    if F.BOUNDS.exists():
        bounds.update(json.loads(F.BOUNDS.read_text()))
    lean = F.tracked_pools()
    d = FIRST
    while d <= LAST:
        day = d.isoformat()
        nxt = (d + timedelta(days=1)).isoformat()
        if day not in bounds or nxt not in bounds:
            print("missing day bounds for", day, flush=True)
            return 1
        F.fetch_day_logs(day, bounds, lean)
        d += timedelta(days=1)
    print("history ready", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
