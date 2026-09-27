$ErrorActionPreference = "Stop"
$nodeBin = "C:\Users\lukey\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$env:Path = "$nodeBin;$env:Path"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
python scripts/sign_proportional_canary_deployer_steps.py final
if ($LASTEXITCODE -eq 0) {
  Write-Host "`nVerified. The empty 696xcanary vault is live." -ForegroundColor Green
} else {
  Write-Host "`nThe final deployer step did not complete. Leave this terminal open." -ForegroundColor Red
}
