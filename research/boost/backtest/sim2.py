"""Smart-leverage vault simulator v2 (realistic execution).
- Signal is computed from hour i's close; the trade executes at hour i+DELAY's close (no look-ahead).
- The keeper acts every KEEP hours (missed pokes); the hard leverage ceiling is enforced at every keeper action.
- Cost per trade = FEE_BP + IMPACT_BP per $100k notional (0.01% pool, $25M liquidity) on the vault's real dollar size.
- Borrow: rate r_lo while debt <= CAP_USD (free Morpho liquidity), r_hi above it; NO_BORROW disables leverage (> 1x capped to 1x).
- Idle USDG earns CASHY. Liquidation against a filtered hourly low at LLTV 0.77 (Morpho LIF).
- Performance fee PERF on gains above the high-water mark, crystallised monthly (taken in kind from NAV).
"""
import csv, math, bisect, statistics as st, datetime as dt
LLTV = 0.77; LIF = 1 / (1 - 0.3 * (1 - LLTV)); YEAR = 8760

class Asset:
    def __init__(self, sym):
        R = [(int(r["ts"]), float(r["high"]), float(r["low"]), float(r["close"])) for r in csv.DictReader(open(f"{sym}_1h.csv"))]
        self.sym = sym; self.T = [r[0] for r in R]; self.P = [r[3] for r in R]; self.H = [r[1] for r in R]
        P = self.P
        self.LO = [max(R[i][2], 0.85 * min(P[i], P[i - 1] if i else P[i])) for i in range(len(R))]
    def idx(self, y, m=1, d=1):
        return bisect.bisect_left(self.T, dt.datetime(y, m, d, tzinfo=dt.timezone.utc).timestamp())
    def ema(self, days):
        a = 2 / (days * 24 + 1); e = self.P[0]; out = []
        for p in self.P: e += a * (p - e); out.append(e)
        return out
    def ewvol(self, hl_days):
        a = 1 - 0.5 ** (1 / (hl_days * 24)); v = 0.0; out = [0.0]; P = self.P
        for i in range(1, len(P)):
            r = math.log(P[i] / P[i - 1]); v = (1 - a) * v + a * r * r; out.append(math.sqrt(v * YEAR))
        # warm start: first two weeks use the long-run ETH-like level instead of ~0
        for i in range(min(len(out), hl_days * 48)): out[i] = max(out[i], 0.8)
        return out

def run(A, L, start, end=None, delay=1, keep=1, band=0.25, ceil=2.0, fee_bp=1.0, impact_bp=3.4, size_usd=50_000, chunk_usd=None, outage=None, lltv=LLTV,
        r_lo=0.05, r_hi=0.15, cap_usd=45_000, no_borrow=False, cashy=0.04, perf=0.0, brake=None):
    P, LO, T = A.P, A.LO, A.T; end = end or len(P); lif = 1 / (1 - 0.3 * (1 - lltv))
    scale = size_usd / P[start]                      # 1 unit of equity = size_usd dollars at start (for impact and capacity)
    eq = 1.0; E = eq / P[start]; D = 0.0
    navs = [eq]; days = [eq]; peak = eq; mdd = 0.0; hwm = eq; liq = 0; trades = 0; lev_sum = 0.0; n = 0; fees_paid = 0.0
    month = dt.datetime.fromtimestamp(T[start], dt.timezone.utc).month; vpeak = eq
    def tgt(i):
        x = L[max(i - delay, 0)]
        if no_borrow: x = min(x, 1.0)
        return min(x, ceil)
    for i in range(start + 1, end):
        rate = cashy
        # the vault's TVL is held at size_usd (capped vault): debt and trade dollars scale with the fraction of NAV
        if D > 0: rate = r_lo if D / max(E * P[i - 1] - D, 1e-12) * size_usd <= cap_usd else r_hi
        D *= 1 + rate / YEAR
        if D > 0 and D > lltv * E * LO[i]:
            liq += 1; seize = min(E, D * lif / LO[i]); E -= seize; D = max(0.0, D - seize * LO[i] / lif)
        nav = E * P[i] - D
        if nav <= 0: navs.append(0.0); mdd = -1.0; break
        lev = E * P[i] / nav; lev_sum += lev; n += 1
        down = outage is not None and outage[0] <= i < outage[0] + outage[1]
        if (i - start) % keep == 0 and not down:
            Lt = tgt(i)
            if brake is not None:                                             # drawdown brake: cap leverage after a deep vault drawdown
                vpeak = max(vpeak, nav)
                if nav / vpeak - 1 < -brake[0]: Lt = min(Lt, brake[1])
            if abs(lev - Lt) > band or lev > ceil:
                dE = (Lt * nav - E * P[i]) / P[i]; notional = abs(dE * P[i])
                if chunk_usd and notional / nav * size_usd > chunk_usd and lev <= ceil + 0.25:   # sliced execution, one slice per keeper action
                    k = chunk_usd / (notional / nav * size_usd); dE *= k; notional *= k
                c = (fee_bp + impact_bp * notional / nav * size_usd / 100_000) / 1e4
                E += dE; D += dE * P[i] + notional * c; trades += 1
        nav = E * P[i] - D
        m = dt.datetime.fromtimestamp(T[i], dt.timezone.utc).month
        if perf and m != month:
            if nav > hwm:
                fee = (nav - hwm) * perf; fees_paid += fee
                D += fee                                                       # paid from the vault (as if minted shares to the fee recipient)
                nav -= fee
            hwm = max(hwm, nav); month = m
        navs.append(nav); peak = max(peak, nav); mdd = min(mdd, nav / peak - 1)
        if (T[i] % 86400) == 0: days.append(nav)
    nav = navs[-1]; yrs = (T[min(end, len(P)) - 1] - T[start]) / (365.25 * 86400)
    cagr = nav ** (1 / yrs) - 1 if nav > 0 else -1.0
    rets = [days[k + 1] / days[k] - 1 for k in range(len(days) - 1) if days[k] > 0]
    sharpe = st.mean(rets) / st.pstdev(rets) * math.sqrt(365) if len(rets) > 2 and st.pstdev(rets) > 0 else 0.0
    neg = [r for r in rets if r < 0]; sortino = st.mean(rets) / math.sqrt(sum(r * r for r in neg) / len(rets)) * math.sqrt(365) if neg else 0.0
    hold = P[min(end, len(P)) - 1] / P[start]
    return dict(cagr=cagr, mdd=mdd, sharpe=sharpe, sortino=sortino, liq=liq, trades=trades, avglev=lev_sum / max(n, 1),
                final=nav, ethx=nav / hold, hold=hold, calmar=cagr / -mdd if mdd < 0 else 0, days=days)

# ---------------- signal builders (all causal: use data up to and including hour i) ----------------
def ens_signal(A, spans=(20, 50, 100, 200), tv=1.0, cap=2.0, hl=14, floor=0.0, hyst=0.0, power=1.0, trend_only=False, cache={}):
    key = (A.sym, spans, hl)
    if key not in cache:
        cache[key] = ({d: A.ema(d) for d in spans}, A.ewvol(hl))
    EM, V = cache[key]; P = A.P; out = []; state = {d: False for d in spans}
    for i in range(len(P)):
        for d in spans:                                   # hysteresis: flip on only above EMA*(1+h), off only below EMA*(1-h)
            if P[i] > EM[d][i] * (1 + hyst): state[d] = True
            elif P[i] < EM[d][i] * (1 - hyst): state[d] = False
        tr = (sum(state.values()) / len(spans)) ** power
        if trend_only: out.append(tr); continue
        out.append(max(floor, tr * max(0.0, min(cap, tv / max(V[i], 1e-9)))))
    return out
