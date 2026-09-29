$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$preflightPath = if ($env:HOODX_FEE_MACHINE_PREFLIGHT_PATH) { $env:HOODX_FEE_MACHINE_PREFLIGHT_PATH } else { "deployments\fee-machine-launch-preflight.json" }
$preflight = Get-Content -LiteralPath $preflightPath -Raw | ConvertFrom-Json
if ($preflight.status -ne "READY_TO_DEPLOY_AND_BOOTSTRAP") {
  throw "Fee Machine preflight is $($preflight.status). Run a fresh preflight and satisfy every gate first."
}
$age = (Get-Date).ToUniversalTime() - [DateTime]::Parse($preflight.generatedAt).ToUniversalTime()
if ($age.TotalMinutes -gt 15) { throw "Fee Machine preflight is stale. Refresh it before deployment." }
$env:ROBINHOOD_RPC_URL = (Get-Content -LiteralPath "C:\Users\lukey\Desktop\RH RPC.txt" -Raw).Trim()
$env:HOODX_FEE_MACHINE_SEED_WEI = $preflight.pilot.seedWei
$env:HOODX_FEE_MACHINE_INITIAL_SHARES = $preflight.pilot.initialShares
$env:HOODX_FEE_MACHINE_DEPLOYER_NONCE = $preflight.accounts.deployer.nonce
for ($i = 0; $i -lt 4; $i++) { Set-Item -Path "Env:HOODX_FEE_MACHINE_CENTER_$i" -Value $preflight.pilot.centers[$i] }
$env:HOODX_LIVE_BROADCAST = "1"
$env:HOODX_DEPLOY_STAGE = "fee-machine-pilot"
$env:HOODX_REVIEWED_BUILD = $preflight.deployment.creationCodeHash

Write-Host "HOODX Fee Machine — reviewed deployer transaction" -ForegroundColor Cyan
Write-Host "Value: 0 ETH. This creates the launcher, controller, index, and four sleeves."
Write-Host "It cannot fund the pilot or mint FEEX. The password stays in Foundry's local keystore prompt.`n"
& "..\work\foundry\forge.exe" script "script/DeployFeeMachineV1.s.sol:DeployFeeMachineV1" `
  --rpc-url $env:ROBINHOOD_RPC_URL --account hoodx-deployer-v2 `
  --sender 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19 --broadcast --slow -vv
if ($LASTEXITCODE -ne 0) { throw "Deployment did not complete. Do not continue to funding." }
Write-Host "`nDeployment submitted. Run the receipt verifier before opening the curator signer." -ForegroundColor Green
