from sim2 import *
for sym, starts in (("eth", [(2016,10),(2022,1)]), ("btc", [(2016,10),(2022,1)]), ("sol", [(2021,10),(2022,1)])):
    A = Asset(sym); L = ens_signal(A)
    for (y, m) in starts:
        a = A.idx(y, m); b = len(A.P)
        r = run(A, L, a, b, perf=0.10); h = run(A, [1.0] * len(A.P), a, b)
        nb = run(A, L, a, b, perf=0.10, no_borrow=True)
        print(f"{sym.upper()} from {y}-{m:02d}: HOLD {h['cagr']*100:+5.0f}%/yr dd{h['mdd']*100:4.0f} sh{h['sharpe']:4.2f} | SMART 0-2x {r['cagr']*100:+5.0f}%/yr dd{r['mdd']*100:4.0f} sh{r['sharpe']:4.2f} coinX{r['ethx']:6.2f} liq{r['liq']} | SMART 0-1x {nb['cagr']*100:+5.0f}%/yr dd{nb['mdd']*100:4.0f} sh{nb['sharpe']:4.2f}")
