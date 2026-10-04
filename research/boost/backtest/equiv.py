from hv import *
import boost_signal_ref as R
WAD = R.WAD
bmap = dict(zip(BTC.T, BTC.P))
# common hours (ETH clock), BTC carried forward like the backtest
hrs, pe, pb = [], [], []; last_b = BTC.P[0]
for t, p in zip(ETH.T, ETH.P):
    last_b = bmap.get(t, last_b); hrs.append(t // 3600); pe.append(int(round(p * 1e8)) * 10**10); pb.append(int(round(last_b * 1e8)) * 10**10)
s = R.Signal([pe[0]] * 8, [pb[0]] * 8, 0, 0, int(0.8**2 / 8760 * WAD), pe[0], hrs[0])
onchain = [s.target()]
for i in range(1, len(hrs)): onchain.append(s.poke(hrs[i], pe[i], pb[i]))
onchain = [x / WAD for x in onchain]
fl = high_signal(ETH, BTC, cap=2.0, tv=2.4)
diff = [abs(a - b) for a, b in zip(onchain, fl)]
i0 = ETH.idx(2016, 10)
big = sum(1 for d in diff[i0:] if d > 0.01)
print(f"hours compared {len(diff)-i0:,}; mean |diff| {sum(diff[i0:])/(len(diff)-i0):.5f}; hours with |diff|>0.01: {big} ({big/(len(diff)-i0):.2%}); max {max(diff[i0:]):.3f}")
KW = {**RUN, "ceil": 2.0}
for nm, a, b in (("2016-21", ETH.idx(2016, 10), ETH.idx(2022)), ("2022-26", ETH.idx(2022), None)):
    r1 = run(ETH, fl, a, b, **KW); r2 = run(ETH, onchain, a, b, **KW)
    print(f"{nm}: backtest model {r1['cagr']:+.1%}/yr dd {r1['mdd']:.1%} | on-chain formula {r2['cagr']:+.1%}/yr dd {r2['mdd']:.1%} liq {r2['liq']}")
