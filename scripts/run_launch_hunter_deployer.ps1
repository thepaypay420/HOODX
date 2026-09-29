$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$preflight = Get-Content (Join-Path $root "deployments\launch-hunter-launch-preflight.json") | ConvertFrom-Json
if ($preflight.status -ne "READY_TO_DEPLOY") {
  throw "Launch Hunter preflight is $($preflight.status). Refresh it and resolve every gate first."
}

$env:HOODX_LIVE_BROADCAST = "1"
$env:HOODX_DEPLOY_STAGE = "launch-hunter-v1"
$env:ROBINHOOD_RPC_URL = (Get-Content "C:\Users\lukey\Desktop\RH RPC.txt" -Raw).Trim()

Write-Host "HOODX Launch Hunter - reviewed infrastructure deployment" -ForegroundColor Cyan
Write-Host "This deploys the route policy and closed HUNTX vault. It does not fund the vault or buy any launch token."
Write-Host "The deployer receives no ownership. The official curator owns the policy and is the only bootstrap authority.`n"

& (Join-Path $root "..\work\foundry\forge.exe") script `
  "script/DeployLaunchHunterV1.s.sol:DeployLaunchHunterV1" `
  --rpc-url $env:ROBINHOOD_RPC_URL `
  --account hoodx-deployer-v2 `
  --broadcast `
  -vv

if ($LASTEXITCODE -ne 0) { throw "Launch Hunter deployment did not complete." }
