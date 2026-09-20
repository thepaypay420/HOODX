"""Scan tracked and candidate files without printing any matched secret value."""
import os,re,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
paths=subprocess.check_output(["git","ls-files","--cached","--others","--exclude-standard","-z"],cwd=root).decode().split("\0")
secret=os.environ.get("ROBINHOOD_RPC_URL","")
patterns=[re.compile(rb"https?://[^\s\"'<>]*quiknode\.pro/[^\s\"'<>]+",re.I),re.compile(rb"-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----"),re.compile(rb"(?:PRIVATE_KEY|private_key)\s*[:=]\s*[\"']?(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])")]
hits=[];count=0
for name in paths:
    p=root/name
    if not name or not p.is_file():continue
    data=p.read_bytes();count+=1
    if (secret and secret.encode()in data)or any(pattern.search(data)for pattern in patterns):hits.append(name)
print("Scanned",count,"files; suspicious files:",len(hits))
for name in hits:print(name)
raise SystemExit(bool(hits))
