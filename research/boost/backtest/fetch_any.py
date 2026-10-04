"""ETH-USD hourly candles from Coinbase (public), 2016 -> now. Writes eth_1h.csv: ts,open,high,low,close,volume"""
import json, time, urllib.request, datetime as dt, os
import sys
PROD = sys.argv[1]
H = {"user-agent": "research", "accept": "application/json"}
def get(u):
    for k in range(6):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=H), timeout=30))
        except Exception as e: time.sleep(2 + 2 * k)
    return []
rows = {}
end = int(time.time()) // 3600 * 3600; start = int(dt.datetime(2016, 6, 1, tzinfo=dt.timezone.utc).timestamp())
t = start
while t < end:
    t2 = min(t + 300 * 3600, end)
    s = dt.datetime.fromtimestamp(t, dt.timezone.utc).isoformat(); e = dt.datetime.fromtimestamp(t2, dt.timezone.utc).isoformat()
    for r in get(f"https://api.exchange.coinbase.com/products/{PROD}-USD/candles?granularity=3600&start={s}&end={e}"):
        rows[r[0]] = (r[3], r[2], r[1], r[4], r[5])   # [time, low, high, open, close, volume] -> open, high, low, close, vol
    t = t2; time.sleep(0.15)
with open(f"{PROD.lower()}_1h.csv", "w") as f:
    f.write("ts,open,high,low,close,volume\n")
    for k in sorted(rows): f.write(f"{k},{','.join(str(x) for x in rows[k])}\n")
print(len(rows), "hours", dt.datetime.fromtimestamp(min(rows), dt.timezone.utc), "->", dt.datetime.fromtimestamp(max(rows), dt.timezone.utc))
