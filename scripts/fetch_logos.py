"""Save every asset logo the HUD shows as a small static WebP in public/logos/, plus a manifest.

Stocks come from Parqet's symbol logos; RH-chain tokens from their DexScreener token image.
Each file is resized to 128x128 and written with a content-hash URL (`/logos/NVDA.webp?v=1a2b3c4d`),
so the CDN can cache them forever and a changed logo gets a new URL automatically.

    python scripts/fetch_logos.py           # fetch missing logos, rewrite manifest
    python scripts/fetch_logos.py --force   # refetch everything

Review the contact sheet it writes (public/logos/_review.jpg is NOT committed) before committing:
ticker collisions are real (the US ticker SPCX is not SpaceX, so SPCX uses the bundled rocket mark).
"""
import hashlib, io, json, re, sys, urllib.request
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "logos"
UA = {"User-Agent": "Mozilla/5.0 (HOODX logo fetch)"}

# RH-chain tokens (not stocks): symbol -> token address on Robinhood Chain 4663
TOKENS = {
    "PONS": "0x39dbed3a2bd333467115de45665cc57f813c4571", "AI": "0x2e8c31162b855a2ffa90f6f8634643ad6f111e18",
    "CASHCAT": "0x020bfc650a365f8bb26819deaabf3e21291018b4", "MEME": "0x385f4f8ae47651ce5f58f5265395a669f8281e18",
    "STONKBROKER": "0xe934e36a439c94017b64a3fece66af12099abf50", "DELTA": "0xe8ffd7e24187f72afb08d75b1bb13088a989a791",
    "UP": "0x57c0e45cb534413d1c20a4240955d6bb250bb4f1", "HOOKR": "0x18e674231a58c239dc7daedcffe15ec3a24cff5c",
    "INDEX": "0x56910d4409f3a0c78c64dd8d0545ff0705389870", "PONGO": "0xedaee44320107caa714baaec486261a87f27022d",
    "GIWA": "0xdab0e8ce3b999d16898709a6dfc44c953bfc43b1", "USDG": "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
}
# Explicit sources where the default lookup has no logo (checked by eye on the review sheet).
FALLBACK = {
    "BB": "https://financialmodelingprep.com/image-stock/BB.png",  # default source maps BB to CMOC, not BlackBerry
    "CRCL": "https://financialmodelingprep.com/image-stock/CRCL.png",
    "GLXY": "https://financialmodelingprep.com/image-stock/GLXY.png",
    "UNI": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984/logo.png",
    "USDG": "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xe343167631d89B6Ffc58B88d6b7fB0228795491D/logo.png",
}
# Symbols whose US ticker is a different company than the Robinhood Chain token: never fetch by ticker.
# DJT: every source still serves the pre-merger DWAC mark, so it shows as a text chip.
NO_TICKER_LOGO = {"SPCX", "DJT"}


def symbols():
    src = (ROOT / "lib" / "vaults.ts").read_text(encoding="utf-8")
    syms = {a.strip().strip('"') for m in re.finditer(r"assets: \[([^\]]+)\]", src) for a in m.group(1).split(",")}
    lp = (ROOT / "lib" / "stockLp.ts").read_text(encoding="utf-8")
    m = re.search(r"stocks: \[([^\]]+)\]", lp)
    if m: syms |= {a.strip().strip('"') for a in m.group(1).split(",")}
    return sorted(s for s in syms if s)


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return r.read(), r.headers.get("content-type", "")


def stock_logo(sym):
    data, ctype = get(f"https://assets.parqet.com/logos/symbol/{sym}?format=png&size=256")
    return data if ctype.startswith("image/") and len(data) > 300 else None


def token_logo(addr):
    data, _ = get(f"https://api.dexscreener.com/token-pairs/v1/robinhood/{addr}")
    pairs = json.loads(data)
    pairs = sorted((p for p in pairs if p.get("baseToken", {}).get("address", "").lower() == addr.lower()), key=lambda p: -(p.get("liquidity") or {}).get("usd", 0))
    for p in pairs:
        url = (p.get("info") or {}).get("imageUrl")
        if url and url.startswith("https://cdn.dexscreener.com/"):
            img, ctype = get(url)
            if ctype.startswith("image/"): return img
    return None


INSET = {"STONKBROKER"}


def save(sym, raw):
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    side = max(im.size); sq = Image.new("RGBA", (side, side), (0, 0, 0, 0)); sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    sq = sq.resize((128, 128), Image.LANCZOS)
    if sym in INSET:  # artwork that fills the square is shrunk onto its own background so a round chip does not crop it
        bg = Image.new("RGBA", (128, 128), sq.getpixel((2, 2))); small = sq.resize((84, 84), Image.LANCZOS); bg.paste(small, (22, 22)); sq = bg
    buf = io.BytesIO(); sq.save(buf, "WEBP", quality=90, method=6); b = buf.getvalue()
    (OUT / f"{sym}.webp").write_bytes(b)
    return b


def main():
    force = "--force" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    manifest, missing = {}, []
    for sym in symbols():
        path = OUT / f"{sym}.webp"
        try:
            if path.exists() and not force:
                b = path.read_bytes()
            elif sym in NO_TICKER_LOGO:
                continue
            else:
                raw = get(FALLBACK[sym])[0] if sym in FALLBACK else token_logo(TOKENS[sym]) if sym in TOKENS else stock_logo(sym)
                if not raw: missing.append(sym); continue
                b = save(sym, raw)
            manifest[sym] = f"/logos/{sym}.webp?v={hashlib.sha256(b).hexdigest()[:8]}"
        except Exception as e:  # network or decode failure: keep the text chip for this symbol
            missing.append(f"{sym} ({e.__class__.__name__})")
    manifest["SPCX"] = "/logos/SPCX.svg"
    (OUT / "manifest.json").write_text(json.dumps(dict(sorted(manifest.items())), indent=1) + "\n", encoding="utf-8")
    # contact sheet for human review (not committed)
    syms = sorted(k for k in manifest if not manifest[k].endswith(".svg")); cols = 10; S = 96
    sheet = Image.new("RGB", (cols * S, ((len(syms) + cols - 1) // cols) * (S + 16)), (40, 40, 40))
    from PIL import ImageDraw; d = ImageDraw.Draw(sheet)
    for i, s in enumerate(syms):
        im = Image.open(OUT / f"{s}.webp").convert("RGBA").resize((S - 16, S - 16)); bg = Image.new("RGBA", im.size, (255, 255, 255, 255)); bg.alpha_composite(im)
        x, y = (i % cols) * S, (i // cols) * (S + 16); sheet.paste(bg.convert("RGB"), (x + 8, y + 4)); d.text((x + 8, y + S - 10), s, fill=(255, 255, 0))
    sheet.save(OUT / "_review.jpg", quality=88)
    print(f"{len(manifest)} logos in manifest; missing (text chip): {missing or 'none'}")


if __name__ == "__main__":
    main()
