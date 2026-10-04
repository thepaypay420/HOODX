import sys, random, math, statistics as st
from multiprocessing import Pool
from hv import *
CANDS = {"SAFE (locked)": (lambda A, B: final_signal(A, B), 1.75),
         "HIGH cap2.0 tv2.4": (lambda A, B: high_signal(A, B, cap=2.0, tv=2.4), 2.0),
         "HIGH cap2.25 tv2.4": (lambda A, B: high_signal(A, B, cap=2.25, tv=2.4), 2.25)}
q = lambda a, p: a[int(p * (len(a) - 1))]
def cohorts(name):
    f, cap = CANDS[name]; L = f(ETH, BTC); kw = {**RUN, "ceil": cap}
    r = run(ETH, L, ETH.idx(2016, 10), **kw); nav = r["days"]
    d0 = ETH.idx(2016, 10); dP = [ETH.P[i] for i in range(d0, len(ETH.P)) if ETH.T[i] % 86400 == 0]; n = min(len(nav), len(dP)); out = []
    for H in (365, 730):
        rows = [(nav[s + H] / nav[s], dP[s + H] / dP[s]) for s in range(120, n - H, 7)]
        v = sorted(x[0] for x in rows)
        out.append(f"{H//365}y: median {q(v,.5)-1:+.0%} p10 {q(v,.1)-1:+.0%} worst {v[0]-1:+.0%} P(loss) {sum(x<1 for x in v)/len(v):.0%} beatETH {sum(a>b for a,b in rows)/len(rows):.0%}")
    t = run(ETH, L, ETH.idx(2022), **kw); dsg = run(ETH, L, ETH.idx(2016, 10), ETH.idx(2022), **kw)
    atcap = sum(1 for i in range(ETH.idx(2016, 10), len(ETH.P)) if L[i] >= cap * 0.97) / (len(ETH.P) - ETH.idx(2016, 10))
    years = []
    for y in range(2017, 2027):
        a, b = ETH.idx(y), (ETH.idx(y + 1) if y < 2026 else len(ETH.P)); years.append(f"{y%100}:{run(ETH, L, a, b, **kw)['final']-1:+.0%}")
    return name, dsg, t, atcap, out, years
# Monte Carlo (paired block bootstrap), shared with t8
exec(open("t8_montecarlo.py").read().split("def path(seed):")[0].split("from final import *")[1])
def path(args):
    seed, name = args; f, cap = CANDS[name]
    rnd = random.Random(seed); idxs = []
    while len(idxs) < N:
        s = rnd.randrange(0, len(er) - BLK); idxs += range(s, s + BLK)
    idxs = idxs[:N]; T = [k * 3600 for k in range(N)]; pe, pb = [2000.0], [30000.0]
    for k in idxs[1:]: pe.append(pe[-1] * math.exp(er[k])); pb.append(pb[-1] * math.exp(br[k]))
    A = Syn("e%d" % seed, pe, [el[k] for k in idxs], T); B = Syn("b%d" % seed, pb, [bl[k] for k in idxs], T)
    s0 = 24 * 120; r = run(A, f(A, B), s0, **{**RUN, "ceil": cap}); return r["final"], pe[-1] / pe[s0], r["mdd"], r["liq"]
if __name__ == "__main__":
    for name in CANDS:
        n, d, t, atcap, co, yrs = cohorts(name)
        print(f"\n== {n} ==\n design 16-21 {d['cagr']:+.0%}/yr dd {d['mdd']:.0%} | test 22-26 {t['cagr']:+.0%}/yr dd {t['mdd']:.0%} ETHx {t['ethx']:.2f} liq {d['liq']+t['liq']} | time at cap {atcap:.0%}")
        print(" cohorts " + " || ".join(co)); print(" years " + " ".join(yrs))
        with Pool(8) as p: res = p.map(path, [(s, name) for s in range(300)])
        v = sorted(x[0] for x in res); cg = lambda x: x ** 0.25 - 1
        print(f" MonteCarlo 4y: median {cg(q(v,.5)):+.0%}/yr p10 {cg(q(v,.1)):+.0%} p5 {cg(q(v,.05)):+.0%} p90 {cg(q(v,.9)):+.0%} P(loss) {sum(x<1 for x in v)/len(v):.0%} beatETH {sum(a>b for a,b,_,_ in res)/len(res):.0%} liq {sum(x[3] for x in res)} medDD {q(sorted(x[2] for x in res),.5):.0%}")
