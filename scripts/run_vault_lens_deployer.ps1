param(
  # Default: the named Foundry account used by every HOODX deployer runner.
  [string]$Account = "hoodx-deployer-v2",
  [string]$Keystore = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$forge = Join-Path $env:USERPROFILE ".foundry\bin\forge.exe"
$deployer = "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19"
$env:ROBINHOOD_RPC_URL = (Get-Content -LiteralPath "C:\Users\lukey\Desktop\RH RPC.txt" -Raw).Trim()
$env:HOODX_LIVE_BROADCAST = "1"
$env:HOODX_DEPLOY_STAGE = "vault-lens"
Write-Host "HOODX vault lens - one deployer transaction (read-only price reader: no funds, no owner)." -ForegroundColor Cyan
Write-Host "Your keystore password is entered only in Foundry's own prompt below.`n"
$wallet = if ($Keystore) { @("--keystore", $Keystore) } else { @("--account", $Account) }
& $forge script "script/DeployVaultLens.s.sol:DeployVaultLens" --rpc-url $env:ROBINHOOD_RPC_URL @wallet --sender $deployer --broadcast --slow -vv
if ($LASTEXITCODE -ne 0) { throw "Deployment did not complete." }
Write-Host "`nDeployed. Send Claude the printed HoodxVaultLens address." -ForegroundColor Green
