$ErrorActionPreference = "Stop"
$nodeBin = "C:\Users\lukey\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$env:Path = "$nodeBin;$env:Path"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
python scripts/sign_proportional_canary_deployer_steps.py
if ($LASTEXITCODE -eq 0) {
  Write-Host "`nVerified. Refresh Brave and continue with Rabby step 3." -ForegroundColor Green
} else {
  Write-Host "`nThe deployer steps did not complete. Leave this terminal open." -ForegroundColor Red
}
