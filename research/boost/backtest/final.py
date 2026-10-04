"""The final candidate signal for the ETH vault, and helpers shared by the validation scripts."""
from sim2 import *
ETH, BTC = Asset("eth"), Asset("btc")
def final_signal(A=ETH, B=BTC, tv=0.8, cap=1.75, hl=14, hyst=0.01, w_btc=0.5):
    own = ens_signal(A, hl=hl, hyst=hyst, trend_only=True)
    bt = ens_signal(B, hl=hl, hyst=hyst, trend_only=True); bmap = dict(zip(B.T, bt))
    V = A.ewvol(hl); out = []; last = 0.0
    for i, t in enumerate(A.T):
        last = bmap.get(t, last)
        out.append(((1 - w_btc) * own[i] + w_btc * last) * max(0.0, min(cap, tv / max(V[i], 1e-9))))
    return out
RUN = dict(band=0.10, ceil=1.75, perf=0.10, size_usd=250e3, chunk_usd=100e3, cap_usd=1e12)
