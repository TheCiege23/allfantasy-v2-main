<#
  Commissioner OS - run the eleven acceptance suites against a prepared branch.

  Reads .env.commish-test (written by commissioner-os-prepare-test-branch.ps1),
  puts those five URLs into the environment, and runs the opt-in vitest config.

  🛑 IT RE-CHECKS THE TARGET RATHER THAN TRUSTING THE FILE. The file was written
  by a script that already refused production - but a file on disk can be edited,
  copied, or go stale, and the cost of being wrong here is writes to production:
  these suites seed tenants and CREATE TABLE scratch probes. A guard that only
  runs at write time protects the moment of writing, not the moment of use.

  USAGE
    powershell -ExecutionPolicy Bypass -File scripts/commissioner-os-run-acceptance.ps1
#>

[CmdletBinding()]
param(
  [string] $EnvFile = '.env.commish-test'
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Test-Path $EnvFile)) {
  Write-Error "REFUSING: $EnvFile not found. Run commissioner-os-prepare-test-branch.ps1 first."
}

function Get-HostFrom([string] $url) {
  return (($url -replace '.*@', '') -replace '/.*', '') -replace ':.*', ''
}

# -- Load the five URLs -------------------------------------------------------
$loaded = @{}
foreach ($line in (Get-Content $EnvFile)) {
  if ($line -match '^\s*#') { continue }
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.+)\s*$') {
    $name = $Matches[1]
    $value = $Matches[2].Trim().Trim('"').Trim("'")
    $loaded[$name] = $value
  }
}

$required = @('DIRECT_URL','DATABASE_URL','COMMISH_MIGRATE_URL','COMMISH_APP_URL','COMMISH_PLATFORM_URL','COMMISH_PURGE_URL')
$missing = $required | Where-Object { -not $loaded.ContainsKey($_) }
if ($missing) { Write-Error "REFUSING: $EnvFile is missing: $($missing -join ', ')" }

# -- Re-check the target at USE time, not just at write time ------------------
$prodLine = Select-String -Path '.env.local', '.env' -Pattern '^DIRECT_URL=' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($prodLine) {
  $prodUrl  = ($prodLine.Line -replace '^DIRECT_URL=', '').Trim().Trim('"').Trim("'")
  $prodEp   = ((Get-HostFrom $prodUrl) -split '\.')[0] -replace '-pooler$', ''
  foreach ($name in $required) {
    $ep = ((Get-HostFrom $loaded[$name]) -split '\.')[0] -replace '-pooler$', ''
    if ($ep -eq $prodEp) {
      Write-Error "REFUSING: $name in $EnvFile resolves to the PRODUCTION endpoint ($prodEp). These suites write. Point them at a branch."
    }
  }
  Write-Output "Target endpoint differs from production ($prodEp). OK."
} else {
  Write-Warning 'No production DIRECT_URL to compare against; proceeding.'
}

$targetHost = Get-HostFrom $loaded['DIRECT_URL']
Write-Output "Running acceptance suites against: $targetHost"
Write-Output ''

foreach ($name in $required) { Set-Item -Path "env:$name" -Value $loaded[$name] }
$env:COMMISH_DB_SPECS = '1'

$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & npx vitest run --config vitest.commissioner-os.config.ts
  $code = $LASTEXITCODE
} finally { $ErrorActionPreference = $prev }

Write-Output ''
if ($code -eq 0) {
  Write-Output 'ACCEPTANCE SUITES PASSED.'
} else {
  Write-Output "ACCEPTANCE SUITES FAILED (vitest exit $code)."
  Write-Output 'That is a result, not an error in the harness - read the failures.'
}
exit $code
