"""Reproducible deployment seed for HoodxBoostSignalV1.

Rebuilds the signal's state (16 EMAs, hysteresis flags, ETH return variance) hour by hour from public Coinbase ETH-USD and
BTC-USD hourly closes since 2016-06, using the integer-exact port of the contract (boost_signal_ref.py), and writes the
constructor arguments to deployments/boost-eth-seed.json. Anyone can rerun it and compare with the deployed seed.

The contract requires the seed's last prices to be within 3% of the live Chainlink feeds, so run this right before deploying.
Usage: python research/boost/boost_seed.py [--cache DIR]
"""
import csv, json, os, sys, time, urllib.request, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import boost_signal_ref as R

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
H = {"user-agent": "hoodx-boost-seed", "accept": "application/json"}

def candles(product, cache):
    path = os.path.join(cache, f"{product.lower()}_1h.csv") if cache else None
    if path and os.path.exists(path) and time.time() - os.path.getmtime(path) < 3600:
        return {int(r["ts"]): float(r["close"]) for r in csv.DictReader(open(path))}
    rows = {}; t = int(dt.datetime(2016, 6, 1, tzinfo=dt.timezone.utc).timestamp()); end = int(time.time()) // 3600 * 3600
    while t < end:
        t2 = min(t + 300 * 3600, end)
        u = (f"https://api.exchange.coinbase.com/products/{product}-USD/candles?granularity=3600"
             f"&start={dt.datetime.fromtimestamp(t, dt.timezone.utc).isoformat()}&end={dt.datetime.fromtimestamp(t2, dt.timezone.utc).isoformat()}")
        for k in range(6):
            try:
                for r in json.load(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=30)): rows[r[0]] = r[4]
                break
            except Exception:
                time.sleep(2 + 2 * k)
        t = t2; time.sleep(0.15)
    if path:
        with open(path, "w") as f:
            f.write("ts,close\n"); [f.write(f"{k},{rows[k]}\n") for k in sorted(rows)]
    return rows

def build(eth, btc):
    hours = sorted(eth); last_b = btc[min(btc)]
    pe, pb, hrs = [], [], []
    for t in hours:
        last_b = btc.get(t, last_b)
        hrs.append(t // 3600); pe.append(int(round(eth[t] * 1e8)) * 10**10); pb.append(int(round(last_b * 1e8)) * 10**10)
    s = R.Signal([pe[0]] * 8, [pb[0]] * 8, 0, 0, int(0.8 ** 2 / 8760 * R.WAD), pe[0], hrs[0])
    for i in range(1, len(hrs)): s.poke(hrs[i], pe[i], pb[i])
    return s, pb[-1]

if __name__ == "__main__":
    cache = sys.argv[sys.argv.index("--cache") + 1] if "--cache" in sys.argv else None
    eth, btc = candles("ETH", cache), candles("BTC", cache)
    s, btc_last = build(eth, btc)
    out = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "lastHour": s.hour, "lastHourUtc": dt.datetime.fromtimestamp(s.hour * 3600, dt.timezone.utc).isoformat(),
        "ethEma": [str(x) for x in s.e["eth"]], "btcEma": [str(x) for x in s.e["btc"]],
        "ethFlags": s.f["eth"], "btcFlags": s.f["btc"], "ethVar": str(s.var),
        "ethLast": str(s.last), "btcLast": str(btc_last),
        "target": s.target() / R.WAD, "sigma": s.sigma() / R.WAD,
        "source": "Coinbase ETH-USD and BTC-USD hourly closes from 2016-06-01, integer-exact replay of HoodxBoostSignalV1",
    }
    dest = os.path.join(ROOT, "deployments", "boost-eth-seed.json")
    json.dump(out, open(dest, "w"), indent=1)
    print(f"seed written to {dest}: target {out['target']:.3f}x, sigma {out['sigma']:.1%}, ETH flags {out['ethFlags']:08b}, BTC flags {out['btcFlags']:08b}")
