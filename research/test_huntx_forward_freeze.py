"""Regression: forward picks are hashed on their first decision day."""

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import huntx_forward_shadow as F


class ForwardFreezeTest(unittest.TestCase):
    def test_late_freeze_is_exploratory(self):
        self.assertEqual(F.freeze_metadata("2026-10-01", datetime(2026, 10, 1, 0, 40, tzinfo=timezone.utc))["evidence_status"], "prospective")
        self.assertEqual(F.freeze_metadata("2026-10-01", datetime(2026, 10, 1, 16, 0, tzinfo=timezone.utc))["evidence_status"], "late_exploratory")

    def test_first_day_freezes_books_before_any_scoring(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "earnings_calendar.json").write_text('{"events": {}}')
            pid = "0x" + "1" * 64
            token = "0x" + "2" * 40
            pool = SimpleNamespace(quote=F.S.USDG, token=token, pid=pid)
            pools = {pid: pool}
            bounds = {"2026-10-01": 100}
            days = ["2026-10-01"]
            with (patch.object(F, "FWD", root),
                  patch.object(F, "CHAIN", root / "chain.txt"),
                  patch.object(F, "chain_head", return_value="genesis"),
                  patch.object(F.V, "STOCKS", {token: "TEST"}),
                  patch.object(F.V, "eligible", return_value=[pid]),
                  patch.object(F.M, "trailing_yield25", return_value=1.0),
                  patch("huntx_route_costs.best_round_trip_bps", return_value={"TEST": 10.0}),
                  patch.object(F, "save_cache")):
                self.assertIsNone(F.slp10k8_book(pools, {}, days, bounds, None, freeze_only=True))
                self.assertEqual(F.cohort_books(pools, {}, days, bounds, None, freeze_only=True), {})
            self.assertEqual(json.loads((root / "slp10k8_picks.json").read_text())["payload"]["picks"][0]["symbol"], "TEST")
            self.assertEqual(json.loads((root / "cohort_2026-10-01.json").read_text())["payload"]["books"]["B0"][0]["symbol"], "TEST")
            self.assertFalse((root / "slp10k8_nav.json").exists())
            self.assertFalse((root / "cohort_nav.json").exists())


if __name__ == "__main__":
    unittest.main()
