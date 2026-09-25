$ErrorActionPreference = "Stop"
$nodeBin = "C:\Users\lukey\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
$env:Path = "$nodeBin;$env:Path"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
python scripts/sign_official_deployer_step.py
if ($LASTEXITCODE -eq 0) {
  Write-Host "`nVerified. You may close this terminal." -ForegroundColor Green
} else {
  Write-Host "`nThe deployer step did not complete. Leave this terminal open." -ForegroundColor Red
}
