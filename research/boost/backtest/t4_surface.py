import itertools, json, sys
from multiprocessing import Pool
from sim2 import *
CASES = [("eth", (2016, 10), (2022, 1)), ("eth", (2022, 1), None), ("btc", (2016, 10), None), ("sol", (2021, 10), None)]
GRID = list(itertools.product((0.8, 1.0, 1.2, 1.4), (1.5, 2.0, 2.5), (7, 14, 30), (0.1, 0.25, 0.4)))
_A = {}
def job(params):
    tv, cap, hl, band = params; out = []
    for sym, s, e in CASES:
        A = _A.setdefault(sym, Asset(sym)); L = ens_signal(A, tv=tv, cap=cap, hl=hl)
        a = A.idx(*s); b = A.idx(*e) if e else len(A.P)
        r = run(A, L, a, b, band=band, ceil=cap, perf=0.10, size_usd=250e3, chunk_usd=100e3, cap_usd=1e12)
        out.append((r['cagr'], r['mdd'], r['sharpe']))
    return params, out
if __name__ == "__main__":
    with Pool(8) as p: res = p.map(job, GRID)
    json.dump([[list(k), v] for k, v in res], open("surface.json", "w"))
    print("tv  cap  hl band | ETH16-21 sh/cagr | ETH22-26 sh/cagr | BTC16-26 sh/cagr | SOL21-26 sh/cagr | mean Sharpe | worst DD")
    for k, v in sorted(res, key=lambda kv: -sum(x[2] for x in kv[1])):
        print(f"{k[0]:.1f} {k[1]:.1f} {k[2]:3d} {k[3]:.2f} | " + " | ".join(f"{x[2]:4.2f} {x[0]*100:+5.0f}%" for x in v) + f" | {sum(x[2] for x in v)/4:5.2f} | {min(x[1] for x in v)*100:4.0f}%")
