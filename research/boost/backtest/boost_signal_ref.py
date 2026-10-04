"""Integer-exact Python port of HoodxBoostSignalV1 (same fixed-point steps, same rounding).
Used for: the deployment seed, Foundry test vectors, and checking the on-chain formula reproduces the backtest."""
from decimal import Decimal, getcontext
getcontext().prec = 60
WAD = 10**18
CAP, TV, GATE, HYST_BPS, HPY, MAX_GAP = 2 * WAD, 24 * 10**17, 75 * 10**16, 100, 8760, 168
VOL_ALPHA = 2_060_811_643_165_591
SPANS = [480, 1200, 2400, 4800, 120, 240, 480, 1200]
def vol_alpha_exact():
    return int((Decimal(1) - Decimal(0.5) ** (Decimal(1) / Decimal(336))) * WAD)
def muldiv(a, b, c): return a * b // c
def powwad(x, n):
    r = WAD
    while n:
        if n & 1: r = muldiv(r, x, WAD)
        x = muldiv(x, x, WAD); n >>= 1
    return r
def isqrt(n):
    import math; return math.isqrt(n)
def count(x): return bin(x & 0xff).count("1")
class Signal:
    def __init__(self, eth_ema, btc_ema, eth_flags, btc_flags, eth_var, eth_last, hour):
        self.e = {"eth": list(eth_ema), "btc": list(btc_ema)}; self.f = {"eth": eth_flags, "btc": btc_flags}
        self.var = eth_var; self.last = eth_last; self.hour = hour
    def _update(self, a, p, k):
        flags = self.f[a]
        for i in range(8):
            keep = powwad(WAD - 2 * WAD // (SPANS[i] + 1), k)
            e = muldiv(self.e[a][i], keep, WAD) + muldiv(p, WAD - keep, WAD)
            self.e[a][i] = e
            if p * 10_000 > e * (10_000 + HYST_BPS): flags |= (1 << i)
            elif p * 10_000 < e * (10_000 - HYST_BPS): flags &= ~(1 << i) & 0xff
        self.f[a] = flags
    def poke(self, hour, pe, pb):   # pe, pb: 18-decimal prices (Chainlink 8 decimals * 1e10)
        assert hour > self.hour
        k = min(hour - self.hour, MAX_GAP)
        diff = abs(pe - self.last); r = muldiv(2 * diff, WAD, pe + self.last)
        r2 = muldiv(r, r, WAD) // k; keep = powwad(WAD - VOL_ALPHA, k)
        self.var = muldiv(self.var, keep, WAD) + muldiv(r2, WAD - keep, WAD); self.last = pe
        self._update("eth", pe, k); self._update("btc", pb, k); self.hour = hour
        return self.target()
    def sigma(self): return isqrt(self.var * HPY * WAD)
    def target(self):
        slow = (count(self.f["eth"] & 0x0f) + count(self.f["btc"] & 0x0f)) * WAD // 8
        fast = (count(self.f["eth"] >> 4) + count(self.f["btc"] >> 4)) * WAD // 8
        lev = slow
        if slow >= GATE:
            s = self.sigma(); vc = CAP if s == 0 else min(CAP, muldiv(TV, WAD, s))
            if vc > WAD: lev += muldiv(vc - WAD, fast, WAD)
        return min(lev, CAP)
if __name__ == "__main__":
    print("VOL_ALPHA exact:", vol_alpha_exact(), "contract:", VOL_ALPHA, "match" if vol_alpha_exact() == VOL_ALPHA else "MISMATCH")
