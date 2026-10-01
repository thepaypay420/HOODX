param(
  # Skip wallet creation (re-register the task with an existing keeper wallet).
  [switch]$RegisterOnly
)
# HOODX Automated LP keeper setup. Run once, in your own terminal.
# Creates a separate gas-only keeper wallet and an hourly Windows task that runs scripts/stock_lp_keeper.py.
# The keeper can only call permissionless, rule-bound cranks on the V2 controller: it cannot move vault funds.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$home_ = Join-Path $env:USERPROFILE ".hoodx\keeper"
$cast = Join-Path $env:USERPROFILE ".foundry\bin\cast.exe"
$python = "C:\Users\lukey\AppData\Local\Microsoft\WindowsApps\python.exe"
$pwFile = Join-Path $home_ "keeper.password"
New-Item -ItemType Directory -Force $home_ | Out-Null

if (-not $RegisterOnly) {
  if (Get-ChildItem $home_ -Filter "*-*-*" -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "keeper.password" }) {
    throw "A keeper keystore already exists in $home_. Use -RegisterOnly to reuse it."
  }
  Write-Host "Choose a password for the NEW keeper wallet (gas-only; it is stored for unattended runs)." -ForegroundColor Cyan
  $secure = Read-Host -AsSecureString "Keeper password"
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if ($plain.Length -lt 12) { throw "Use at least 12 characters." }
  Set-Content -LiteralPath $pwFile -Value $plain -NoNewline -Encoding ascii
  # Only the current Windows user may read the password file.
  icacls $pwFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  $env:CAST_PASSWORD = $plain
  & $cast wallet new $home_ | Out-Null
  Remove-Item Env:CAST_PASSWORD
  $plain = $null
}
$keystore = Get-ChildItem $home_ | Where-Object { $_.Name -ne "keeper.password" -and -not $_.PSIsContainer } | Select-Object -First 1
if (-not $keystore) { throw "No keeper keystore found in $home_." }
$address = (& $cast wallet address --keystore $keystore.FullName --password-file $pwFile).Trim()

$log = Join-Path $home_ "keeper.log"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -WorkingDirectory $root -Argument (
  "/c `"`"$python`" scripts\stock_lp_keeper.py --keystore `"$($keystore.FullName)`" --password-file `"$pwFile`" >> `"$log`" 2>&1`"")
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName "HOODX autopilot keeper" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host "`nKeeper wallet: $address" -ForegroundColor Green
Write-Host "Send it about 0.01 ETH on Robinhood Chain for gas (~`$0.35/day while a range is out of price)."
Write-Host "Hourly task 'HOODX autopilot keeper' registered. Log: $log"
Write-Host "It runs once the V2 vault is live (deployments\stock-lp-vault-v2-live.json)."
