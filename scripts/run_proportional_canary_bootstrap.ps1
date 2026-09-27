$ErrorActionPreference = "Stop"
$nodeBin = "C:\Users\lukey\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$env:Path = "$nodeBin;$env:Path"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
python scripts/sign_proportional_canary_bootstrap.py
if ($LASTEXITCODE -eq 0) {
  Write-Host "`nVerified. The disposable 21-asset canary is seeded with 0.02 ETH." -ForegroundColor Green
} else {
  Write-Host "`nThe canary seed did not complete. Leave this terminal open and do not resubmit." -ForegroundColor Red
}
