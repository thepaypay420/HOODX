param(
  # Default: the named Foundry account used by every HOODX deployer runner.
  [string]$Account = "hoodx-deployer-v2",
  # Optional: a keystore file path instead (e.g. one saved on the Desktop).
  [string]$Keystore = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$forge = Join-Path $env:USERPROFILE ".foundry\bin\forge.exe"
$cast = Join-Path $env:USERPROFILE ".foundry\bin\cast.exe"
$deployer = "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19"

$manifestPath = if ($env:HOODX_STOCK_LP_MANIFEST) { $env:HOODX_STOCK_LP_MANIFEST } else { "deployments\stock-lp-vault-v2-manifest.json" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.status -ne "APPROVED") {
  throw "Manifest status is '$($manifest.status)'. Finalize the basket and set status to APPROVED (with reviewedBuild) first."
}
if (-not $manifest.reviewedBuild) { throw "Manifest has no reviewedBuild fingerprint." }

$env:ROBINHOOD_RPC_URL = (Get-Content -LiteralPath "C:\Users\lukey\Desktop\RH RPC.txt" -Raw).Trim()
$env:HOODX_STOCK_LP_DEPLOYER_NONCE = (& $cast nonce $deployer --rpc-url $env:ROBINHOOD_RPC_URL).Trim()
$env:HOODX_LIVE_BROADCAST = "1"
$env:HOODX_DEPLOY_STAGE = "stock-lp-vault-v2"
$env:HOODX_REVIEWED_BUILD = $manifest.reviewedBuild

Write-Host "HOODX Automated LP (autopilot V2) - reviewed deployer transactions" -ForegroundColor Cyan
$seedEth = [decimal]$manifest.seedEthWei / 1e18
Write-Host "Basket: $($manifest.count) stocks, cap `$$([decimal]$manifest.tvlCapUsdg / 1e6)."
Write-Host "Creates price references, sleeves, the vault, the controller and a one-shot seeder; activates the"
Write-Host "controller; then seeds every sleeve with $seedEth ETH and mints the first shares to the treasury."
Write-Host "Leftovers are sold back and refunded in the same transaction. Total cost ~ $seedEth ETH + ~0.0025 ETH gas."
Write-Host "Curator and fee recipient: 0x134D468B0bcaeA6DF127916f951F7938c06A37C6."
Write-Host "Your keystore password is entered only in Foundry's own prompt below.`n"

$wallet = if ($Keystore) { @("--keystore", $Keystore) } else { @("--account", $Account) }
& $forge script "script/DeployStockLpVaultV2.s.sol:DeployStockLpVaultV2" `
  --rpc-url $env:ROBINHOOD_RPC_URL @wallet --sender $deployer --broadcast --slow -vv
if ($LASTEXITCODE -ne 0) { throw "Deployment did not complete. Do not continue to seeding." }
Write-Host "`nDeployed and seeded. Record the printed Vault and Controller addresses." -ForegroundColor Green
