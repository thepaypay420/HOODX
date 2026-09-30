"""A20: capacity of the stock-LP vault (B0, B2) at $200 / $2k / $20k. Descriptive."""
import json, statistics
from pathlib import Path
import huntx_slp_beta as B
import huntx_slp_continuous as SC
import huntx_stock_mgmt as M
from huntx_edge_engine import save_cache

ROOT = Path(__file__).parent


def main():
    bounds, clock, proto, pools = M.setup()
    out = {}
    for start, end, tag in B.windows():
        ids = B.picks_at(pools, bounds, proto, start)
        row = {"tag": tag}
        for book, mode in (("B0", "fixed:0.01"), ("B2", "skew:0.985:1.005")):
            for size in (200.0, 2000.0, 20000.0):
                r = SC.run_vault(pools, bounds, proto, start, end, 8, mode, capital=size, symbols=ids)
                row[f"{book}_{int(size)}_pct"] = round(100 * r["net_usd"] / size, 3)
        out[start] = row
        save_cache()
        print(start, json.dumps(row), flush=True)
    summ = {}
    for book in ("B0", "B2"):
        for size in (200, 2000, 20000):
            vals = [out[s][f"{book}_{size}_pct"] for s in out]
            summ[f"{book}_{size}"] = {"mean_pct": round(statistics.mean(vals), 3), "worst_pct": round(min(vals), 3)}
    (ROOT / "huntx_slp_capacity_results.json").write_text(json.dumps({"windows": out, "summary": summ}, indent=1))
    print("SUMMARY", json.dumps(summ), flush=True)


if __name__ == "__main__":
    main()
