import json
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from weights import allocate, list_target_bps, usd_sleeves


def _uni(*rows):
    return {"policy": "capped_sqrt", "tokens": list(rows)}


class WeightTest(unittest.TestCase):
    def test_mcap_does_not_give_pons_the_fund(self):
        rows = [
            {"id": "PONS", "listedMcapUsd": 412_300_000, "listedQuote": "WETH", "buyTvlUsd": 5_000_000, "vol24Usd": 1_000_000},
            {"id": "AI", "listedMcapUsd": 268_800_000, "listedQuote": "WETH", "buyTvlUsd": 4_000_000, "vol24Usd": 1_000_000},
            {"id": "CASHCAT", "listedMcapUsd": 151_300_000, "listedQuote": "WETH", "buyTvlUsd": 4_000_000, "vol24Usd": 1_000_000},
        ]
        for i in range(12):
            rows.append(
                {
                    "id": f"T{i}",
                    "listedMcapUsd": 5_000_000,
                    "listedQuote": "WETH",
                    "buyTvlUsd": 200_000,
                    "vol24Usd": 50_000,
                }
            )
        plan = allocate(_uni(*rows))
        by = {s["id"]: s["weight"] for s in plan["sleeves"]}
        self.assertAlmostEqual(plan["weightSum"], 1.0, places=5)
        self.assertLessEqual(by["PONS"], 0.10 + 1e-9)
        self.assertGreaterEqual(by["T0"], 0.03 - 1e-9)
        self.assertLess(by["PONS"], 0.20)

    def test_dead_volume_is_dropped(self):
        uni = _uni(
            {"id": "LIVE", "listedMcapUsd": 10_000_000, "listedQuote": "WETH", "buyTvlUsd": 400_000, "vol24Usd": 80_000},
            {"id": "DEAD", "listedMcapUsd": 10_000_000, "listedQuote": "WETH", "buyTvlUsd": 400_000, "vol24Usd": 0.02},
        )
        plan = allocate(uni)
        ids = {s["id"] for s in plan["sleeves"]}
        self.assertEqual(ids, {"LIVE"})
        self.assertEqual(plan["skipped"][0]["id"], "DEAD")

    def test_two_hop_gets_haircut(self):
        uni = _uni(
            {"id": "WETHA", "listedMcapUsd": 10_000_000, "listedQuote": "WETH", "buyTvlUsd": 400_000, "vol24Usd": 50_000, "hops": 1},
            {"id": "SPY", "listedMcapUsd": 10_000_000, "listedQuote": "SPY", "buyTvlUsd": 400_000, "vol24Usd": 50_000, "hops": 2},
        )
        plan = allocate(uni)
        raw = {s["id"]: s["rawSqrt"] for s in plan["sleeves"]}
        self.assertGreater(raw["WETHA"], raw["SPY"])

    def test_usd_sleeves_sum_to_nav(self):
        uni = _uni(
            {"id": "A", "listedMcapUsd": 50_000_000, "listedQuote": "WETH", "buyTvlUsd": 1_000_000, "vol24Usd": 100_000},
            {"id": "B", "listedMcapUsd": 20_000_000, "listedQuote": "WETH", "buyTvlUsd": 800_000, "vol24Usd": 80_000},
            {"id": "C", "listedMcapUsd": 8_000_000, "listedQuote": "WETH", "buyTvlUsd": 300_000, "vol24Usd": 40_000},
        )
        plan = allocate(uni)
        sleeves = usd_sleeves(1_000, plan)
        self.assertAlmostEqual(sum(s["usd"] for s in sleeves), 1_000, places=1)

    def test_repo_universe_loads(self):
        plan = allocate()
        self.assertGreaterEqual(plan["nListed"], 18)
        self.assertGreaterEqual(plan["nTradeable"], 10)
        self.assertAlmostEqual(plan["weightSum"], 1.0, places=4)
        pons = next(s for s in plan["sleeves"] if s["id"] == "PONS")
        self.assertLessEqual(pons["weight"], 0.10 + 1e-9)

    def test_list_target_bps_keeps_cash_and_caps_pons(self):
        plan = allocate()
        listed = [s["token"] for s in plan["sleeves"] if s.get("token")]
        who, bps = list_target_bps(listed, 400.0, 16 * 10**16, 4 * 10**15, 2500, plan)
        by = {t.lower(): b for t, b in zip(who, bps)}
        pons = next(s for s in plan["sleeves"] if s["id"] == "PONS")
        self.assertIn(pons["token"], by)
        self.assertLessEqual(by[pons["token"]], 1000)
        self.assertLessEqual(sum(bps), 7500)
        self.assertGreaterEqual(len(who), 2)


if __name__ == "__main__":
    unittest.main()
