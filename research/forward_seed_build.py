"""Builds research/forward_seed.tar.gz: the small, static inputs the daily forward job needs on a cloud runner.

Swap history is NOT bundled: the runner fetches 2026-09-20..29 from chain once (forward_bootstrap.py) and
caches it. Contents (all derived from public chain data):
  - huntx_edge_logs/meta.json: pool metadata for the tracked (lean) pools, stock/USDG pools and ETH/USDG
  - huntx_edge_activity_screen.json reduced to its day_bounds
  - huntx_edge_state_panel.json.gz, huntx_edge_prospective_2026-09-30.json (as is)
  - huntx_edge_registry.json.gz reduced to hookless USDG pools of canonical stocks + the ETH/USDG reference
"""
import gzip, io, json, tarfile
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "forward_seed.tar.gz"
HIST_DIRS = ["huntx_edge_logs", "huntx_edge_logs_gap", "huntx_edge_logs_gap2"]
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
ETH_REF = "0x24107d152f14a76d292123265ae3f3c71f863fc2f4ef7ba49d64e78d28ea379e"


def add_bytes(tar, name, data: bytes):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    tar.addfile(info, io.BytesIO(data))


def main():
    bounds = json.loads((ROOT / "huntx_edge_activity_screen.json").read_text())["day_bounds"]
    lean = set(json.load(gzip.open(ROOT / "huntx_edge_state_panel.json.gz", "rt", encoding="utf-8"))["pools"])
    stocks = {t["token"].lower() for t in json.loads((ROOT.parent / "public" / "rh_stocks.json").read_text())["tokens"]}
    reg = json.load(gzip.open(ROOT / "huntx_edge_registry.json.gz"))
    stock_pools = [p for p in reg["pools"] if p["pool_id"] == ETH_REF or (
        int(p["hooks"], 16) == 0 and (p["currency1"] if p["currency0"] == USDG else p["currency0"] if p["currency1"] == USDG else None) in stocks)]
    keep = lean | {p["pool_id"] for p in stock_pools}
    metas = {}
    for d in HIST_DIRS:
        for pid, m in json.loads((ROOT / d / "meta.json").read_text())["pools"].items():
            if pid in keep:
                metas.setdefault(pid, m)
    for p in stock_pools:  # registry rows double as metadata for pools absent from the logs
        metas.setdefault(p["pool_id"], {k: p[k] for k in ("currency0", "currency1", "fee", "tick_spacing", "hooks")})
    with tarfile.open(OUT, "w:gz", compresslevel=9) as tar:
        add_bytes(tar, "research/huntx_edge_logs/meta.json", json.dumps({"pools": metas}).encode())
        for d in HIST_DIRS[1:]:
            add_bytes(tar, f"research/{d}/meta.json", json.dumps({"pools": {}}).encode())
        add_bytes(tar, "research/huntx_edge_activity_screen.json", json.dumps({"day_bounds": bounds}).encode())
        add_bytes(tar, "research/huntx_edge_registry.json.gz", gzip.compress(json.dumps({"pools": stock_pools}).encode()))
        tar.add(ROOT / "huntx_edge_state_panel.json.gz", "research/huntx_edge_state_panel.json.gz")
        tar.add(ROOT / "huntx_edge_prospective_2026-09-30.json", "research/huntx_edge_prospective_2026-09-30.json")
    print(f"{OUT.name}: {OUT.stat().st_size / 1e6:.2f} MB, {len(metas):,} pool metas, {len(stock_pools)} registry rows")


if __name__ == "__main__":
    main()
