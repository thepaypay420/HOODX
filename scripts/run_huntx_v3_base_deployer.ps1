$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$env:HOODX_FEE_MACHINE_PREFLIGHT_PATH = "deployments\huntx-v3-base-preflight.json"
& "$PSScriptRoot\run_fee_machine_deployer.ps1"
if ($LASTEXITCODE -ne 0) { throw "HUNTX base deployment did not complete." }
