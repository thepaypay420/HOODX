from hv import *
import itertools
H = lambda A=ETH, B=BTC, **k: high_signal(A, B, cap=2.0, tv=2.4, **k)
L = H(); KW = {**RUN, "ceil": 2.0}
print("capacity, 2022-26:")
for size in (50e3, 250e3, 1e6, 3e6):
    r = run(ETH, L, ETH.idx(2022), **{**KW, "size_usd": size, "cap_usd": 1e12}); r2 = run(ETH, L, ETH.idx(2016, 10), ETH.idx(2022), **{**KW, "size_usd": size, "cap_usd": 1e12})
    print(f"  TVL ${size/1e6:.2f}M: 2022-26 {r['cagr']:+.0%}/yr, 2016-21 {r2['cagr']:+.0%}/yr, trades/yr {r['trades']/4.75:.0f}")
print("keeper outage at crash hour (30-day window return):")
for name, (y, m, d) in {"COVID": (2020, 3, 12), "May-21": (2021, 5, 19), "LUNA": (2022, 5, 9), "FTX": (2022, 11, 8), "Aug-24": (2024, 8, 5), "Oct-25": (2025, 10, 10)}.items():
    t0 = ETH.idx(y, m, d); a = t0 - 72; b = t0 + 24 * 27; base = run(ETH, L, ETH.idx(2016, 10), a, **KW)["final"]
    print(f"  {name:7s} ETH {ETH.P[b]/ETH.P[a]-1:+.0%} | " + " | ".join(f"{o}h out {run(ETH, L, ETH.idx(2016,10), b, outage=(t0,o) if o else None, **KW)['final']/base-1:+.0%}" for o in (0, 24, 48, 72)))
gp = []; last = ETH.P[0]; lt = ETH.T[0]
for p, t in zip(ETH.P, ETH.T):
    if abs(p / last - 1) >= 0.005 or t - lt >= 86400: last, lt = p, t
    gp.append(last)
class Gated(Asset):
    def __init__(s): s.__dict__.update(ETH.__dict__); s.sym = "eth_g"; s.P = gp
LG = H(Gated(), BTC)
print("Chainlink-gated price: " + " | ".join(f"{y}: {run(ETH, LG, ETH.idx(y, 10 if y == 2016 else 1), ETH.idx(2022) if y == 2016 else None, **KW)['cagr']:+.0%}/yr" for y in (2016, 2022)))
print("walk-forward (re-pick cap/tv/gate each year on past data) vs fixed:")
G = list(itertools.product((1.75, 2.0), (1.6, 2.4, 3.0), (0.5, 0.75)))
sig = {g: high_signal(ETH, BTC, cap=g[0], tv=g[1], gate=g[2]) for g in G}
wf = fx = ho = 1.0
for y in range(2019, 2027):
    a0, a, b = ETH.idx(2016, 10), ETH.idx(y), (ETH.idx(y + 1) if y < 2026 else len(ETH.P))
    best = max(G, key=lambda g: math.log(max(run(ETH, sig[g], a0, a, **{**RUN, "ceil": g[0]})["final"], 1e-9)))
    wf *= run(ETH, sig[best], a, b, **{**RUN, "ceil": best[0]})["final"]; fx *= run(ETH, L, a, b, **KW)["final"]; ho *= ETH.P[b - 1] / ETH.P[a]
print(f"  2019-26: walk-forward x{wf:.0f}, fixed x{fx:.0f}, ETH x{ho:.0f}")
