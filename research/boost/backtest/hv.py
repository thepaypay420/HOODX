"""HIGH variant: two-layer ETH leverage. Core = slow trend (ETH+BTC 4-EMA ensemble, 0..1x); booster = fast-trend x vol room,
only while the slow trend is >= gate. No floor."""
from high import *
def high_signal(A=ETH, B=BTC, cap=2.0, tv=2.0, fast=(5, 10, 20, 50), gate=0.75, floor=0.0, w_btc=0.5):
    Bx = B if (B is not None and A is not B) else None
    slow = trend(A, B=Bx, w_btc=w_btc if Bx else 0); fastt = trend(A, B=Bx, w_btc=w_btc if Bx else 0, spans=fast); V = A.ewvol(14); out = []
    for i in range(len(A.P)):
        room = max(0.0, min(cap, tv / max(V[i], 1e-9)) - 1.0)
        out.append(min(cap, max(floor, slow[i]) + (room * fastt[i] if slow[i] >= gate else 0.0)))
    return out
