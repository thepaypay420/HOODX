"""High-upside, ALWAYS-LONG-ETH variants: leverage never below 1x; the signal decides how much extra to add.
Shared harness: ETH design 2016-21, ETH test 2022-26, and the same rule on BTC (2016-26) and SOL (2021-26)."""
from final import *
SOL = Asset("sol")
def trend(A, B=BTC, hyst=0.01, w_btc=0.5, spans=(20, 50, 100, 200)):
    own = ens_signal(A, hyst=hyst, trend_only=True, spans=spans)
    if B is None or w_btc == 0: return own
    bt = ens_signal(B, hyst=hyst, trend_only=True, spans=spans); bmap = dict(zip(B.T, bt)); out = []; last = 0.0
    for i, t in enumerate(A.T): last = bmap.get(t, last); out.append((1 - w_btc) * own[i] + w_btc * last)
    return out
def lin(A, cap, power=1.0, **k):            # 1x + trend^p x (cap-1)
    return [1 + (x ** power) * (cap - 1) for x in trend(A, **k)]
def volsized(A, cap, tv, **k):              # max(1, trend x min(cap, tv/vol))
    V = A.ewvol(14); return [max(1.0, x * min(cap, tv / max(V[i], 1e-9))) for i, x in enumerate(trend(A, **k))]
CASES = [("ETH 16-21", "eth", (2016, 10), (2022, 1)), ("ETH 22-26", "eth", (2022, 1), None), ("BTC 16-26", "btc", (2016, 10), None), ("SOL 21-26", "sol", (2021, 10), None)]
AS = {"eth": ETH, "btc": BTC, "sol": SOL}
def evaluate(name, build, cap):
    s = f"{name:40s}"; gs = []
    for lab, sym, a, b in CASES:
        A = AS[sym]; L = build(A); i0 = A.idx(*a); i1 = A.idx(*b) if b else None
        r = run(A, L, i0, i1, **{**RUN, "ceil": cap})
        s += f" | {r['cagr']*100:+5.0f}% dd{r['mdd']*100:4.0f} L{r['avglev']:.2f}{' LIQ'+str(r['liq']) if r['liq'] else ''}"; gs.append(math.log(1 + r['cagr']))
    print(s + f" | mean log-growth {sum(gs)/4:.3f}")
