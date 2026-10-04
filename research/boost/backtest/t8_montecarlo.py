"""Stationary block bootstrap: 30-day blocks of PAIRED hourly ETH and BTC returns (same calendar hours) from 2016-10 to
2026-10, stitched into 300 synthetic 4-year paths (+120-day warm-up). Each path runs the final design and buy-and-hold."""
import random, math, statistics as st
from multiprocessing import Pool
from final import *
class Syn:
    def __init__(self, sym, P, LOr, T):
        self.sym = sym; self.P = P; self.T = T; self.LO = [p * r for p, r in zip(P, LOr)]
    ema = Asset.ema; ewvol = Asset.ewvol
    def idx(self, *a): return 0
bmap = dict(zip(BTC.T, range(len(BTC.T))))
pairs = [(i, bmap[t]) for i, t in enumerate(ETH.T) if t in bmap and i > 0 and bmap[t] > 0 and t >= ETH.T[ETH.idx(2016, 10)]]
er = [math.log(ETH.P[i] / ETH.P[i - 1]) for i, j in pairs]; br = [math.log(BTC.P[j] / BTC.P[j - 1]) for i, j in pairs]
el = [ETH.LO[i] / ETH.P[i] for i, j in pairs]; bl = [BTC.LO[j] / BTC.P[j] for i, j in pairs]
N = 24 * (365 * 4 + 120); BLK = 24 * 30
def path(seed):
    rnd = random.Random(seed); idxs = []
    while len(idxs) < N:
        s = rnd.randrange(0, len(er) - BLK); idxs += range(s, s + BLK)
    idxs = idxs[:N]; T = [k * 3600 for k in range(N)]
    pe, pb = [2000.0], [30000.0]
    for k in idxs[1:]: pe.append(pe[-1] * math.exp(er[k])); pb.append(pb[-1] * math.exp(br[k]))
    A = Syn("e%d" % seed, pe, [el[k] for k in idxs], T); B = Syn("b%d" % seed, pb, [bl[k] for k in idxs], T)
    L = final_signal(A, B); s0 = 24 * 120
    r = run(A, L, s0, **RUN); h = pe[-1] / pe[s0]
    return r["final"], h, r["mdd"], r["liq"]
if __name__ == "__main__":
    with Pool(8) as p: res = p.map(path, range(300))
    v = sorted(x[0] for x in res); h = sorted(x[1] for x in res); dd = sorted(x[2] for x in res)
    q = lambda a, p: a[int(p * (len(a) - 1))]
    cg = lambda x: x ** (1 / 4) - 1
    print(f"300 synthetic 4-year paths")
    print(f"  vault CAGR: median {cg(q(v,.5)):+.0%}, 10th {cg(q(v,.1)):+.0%}, 5th {cg(q(v,.05)):+.0%}, 90th {cg(q(v,.9)):+.0%}; P(4y loss) {sum(x<1 for x in v)/len(v):.0%}")
    print(f"  ETH   CAGR: median {cg(q(h,.5)):+.0%}, 10th {cg(q(h,.1)):+.0%}, 5th {cg(q(h,.05)):+.0%}, 90th {cg(q(h,.9)):+.0%}; P(4y loss) {sum(x<1 for x in h)/len(h):.0%}")
    print(f"  vault beat ETH on {sum(a>b for a,b,_,_ in res)/len(res):.0%} of paths; median max drawdown {q(dd,.5):.0%}, worst-decile {q(dd,.1):.0%}; liquidations {sum(x[3] for x in res)}")
