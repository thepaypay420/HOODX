param(
  # Default: the named Foundry account used by every HOODX deployer runner.
  [string]$Account = "hoodx-deployer-v2",
  # Optional: a keystore file path instead (e.g. one saved on the Desktop).
  [string]$Keystore = "",
  # Manifest to deploy (v1.1 = the KupiaSec-fixed vault on the live signal). Not named $Manifest internally: PowerShell
  # variables ignore case, so a [string] $Manifest would turn the parsed $manifest object below into text.
  [Alias("Manifest")][string]$ManifestFile = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$forge = Join-Path $env:USERPROFILE ".foundry\bin\forge.exe"
$deployer = "0xf63E63a80A25611154C5d1c06E55FD763E0cfC19"

$manifestPath = if ($ManifestFile) { $ManifestFile } elseif ($env:HOODX_BOOST_MANIFEST) { $env:HOODX_BOOST_MANIFEST } else { "deployments\boost-eth-v1-manifest.json" }
$env:HOODX_BOOST_MANIFEST = $manifestPath
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.status -ne "APPROVED") {
  throw "Manifest status is '$($manifest.status)'. Set status to APPROVED (with reviewedBuild) after the boost test suite passes on the reviewed build."
}
if (-not $manifest.reviewedBuild) { throw "Manifest has no reviewedBuild fingerprint." }

if ($manifest.signal) {
  Write-Host "Reusing the live signal $($manifest.signal) (no new signal, no seed)."
} else {
  Write-Host "Regenerating the signal seed from public price history (must be within 3% of the live feeds)..."
  python research/boost/boost_seed.py --cache research/boost/cache
  if ($LASTEXITCODE -ne 0) { throw "Seed generation failed." }
}

$env:ROBINHOOD_RPC_URL = (Get-Content -LiteralPath "C:\Users\lukey\Desktop\RH RPC.txt" -Raw).Trim()
$env:FOUNDRY_PROFILE = "boost"
$env:HOODX_REVIEWED_BUILD = $manifest.reviewedBuild

Write-Host "HOODX Boosted ETH ($manifestPath) - reviewed deployer transactions" -ForegroundColor Cyan
$seedEth = [decimal]$manifest.seedEthWei / 1e18
$what = if ($manifest.signal) { "the vault (on the live signal)" } else { "the on-chain signal and the vault" }
Write-Host "Deploys $what, bootstraps it with $seedEth ETH (shares to the treasury) and"
Write-Host "hands ownership to the treasury, which then calls acceptOwnership(). Cap `$$([decimal]$manifest.tvlCapUsdg / 1e6)."
Write-Host "Total cost ~ $seedEth ETH + ~0.002 ETH gas. Curator and fee recipient: $($manifest.curatorAndFeeRecipient)."
Write-Host "Your keystore password is entered only in Foundry's own prompt below.`n"

$wallet = if ($Keystore) { @("--keystore", $Keystore) } else { @("--account", $Account) }
& $forge script "script/boost/DeployBoostEthV1.s.sol:DeployBoostEthV1" `
  --rpc-url $env:ROBINHOOD_RPC_URL @wallet --sender $deployer --broadcast --slow -vv
if ($LASTEXITCODE -ne 0) { throw "Deployment did not complete." }
Write-Host "`nDeployed. Record the printed Signal and Vault in deployments/boost-eth-v1-live.json and lib/boost.ts, then have the treasury accept ownership." -ForegroundColor Green
