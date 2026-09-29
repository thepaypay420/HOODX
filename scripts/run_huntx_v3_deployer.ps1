$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$preflight = Get-Content -LiteralPath "deployments\huntx-v3-launch-preflight.json" -Raw | ConvertFrom-Json
if ($preflight.status -ne "READY_TO_DEPLOY") { throw "HUNTX preflight is $($preflight.status). Resolve every gate first." }
$age = (Get-Date).ToUniversalTime() - [DateTime]::Parse($preflight.generatedAt).ToUniversalTime()
if ($age.TotalMinutes -gt 15) { throw "HUNTX preflight is stale. Refresh it before deployment." }
$env:ROBINHOOD_RPC_URL = (Get-Content -LiteralPath "C:\Users\lukey\Desktop\RH RPC.txt" -Raw).Trim()
$env:HUNTX_BASE_INDEX = $preflight.base.index
$env:HUNTX_BASE_INDEX_HASH = $preflight.base.indexRuntimeHash
$env:HUNTX_BASE_SEED_AMOUNT = $preflight.base.seedShares
$env:HUNTX_WETH_SEED_AMOUNT = $preflight.huntx.wethSeedWei
$env:HUNTX_RISK_REFERENCE_AMOUNT = $preflight.huntx.riskReferenceWei
$env:HUNTX_INITIAL_SHARES = $preflight.huntx.initialShares
$env:HUNTX_DEPLOYER_NONCE = $preflight.accounts.deployer.nonce
$env:HOODX_LIVE_BROADCAST = "1"
$env:HOODX_DEPLOY_STAGE = "launch-hunter-v3"
$env:HOODX_REVIEWED_BUILD = $preflight.deployment.creationCodeHash
Write-Host "HOODX Launch Hunter V3 - reviewed deployer transaction" -ForegroundColor Cyan
Write-Host "Value: 0 ETH. This creates the closed-pilot policy and HUNTX vault only."
& "..\work\foundry\forge.exe" script "script/DeployLaunchHunterV3.s.sol:DeployLaunchHunterV3" --rpc-url $env:ROBINHOOD_RPC_URL --account hoodx-deployer-v2 --sender 0xf63E63a80A25611154C5d1c06E55FD763E0cfC19 --broadcast --slow -vv
if ($LASTEXITCODE -ne 0) { throw "HUNTX deployment did not complete. Do not continue to funding." }
Write-Host "Deployment submitted. Verify the launcher before approving FEEX." -ForegroundColor Green
