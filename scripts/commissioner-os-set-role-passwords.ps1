<#
  Commissioner OS - give the four commish_* roles a LOGIN and a password.

  PowerShell twin of commissioner-os-set-role-passwords.sh. Same guarantees; it
  exists because `bash` is not on PATH in a default PowerShell session on this
  machine, and "install Git Bash first" is a worse instruction than a script
  that runs where the operator already is.

  WHY THIS IS A SCRIPT AND NOT FOUR ALTER ROLE STATEMENTS
  The setup docs asked for four ALTER ROLE lines with 'paste-a-generated-value-here'
  and 'a-different-one' as stand-ins. On 2026-08-31 they were run verbatim against
  production, twice. SQL has no substitution step, so those literals BECAME the
  passwords - guessable, three roles sharing one, and printed in plaintext in the
  conversation that produced them.

  The operator did nothing wrong: the console reported "Statement executed
  successfully" with four green ticks, because to Postgres a placeholder and a
  password are the same thing. A placeholder that is valid input is a trap. This
  script generates the values itself, so there is nothing to fill in - which is
  the only property that actually prevents a third occurrence.

  USAGE
    powershell -ExecutionPolicy Bypass -File scripts/commissioner-os-set-role-passwords.ps1
#>

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$EnvFile = '.env.local'

# -- Refuse if .env.local would be committed ---------------------------------
# .gitignore carries `.env*`, but an ALREADY-TRACKED file is not protected by a
# gitignore rule - that is exactly how .env.example and .env.production stay
# tracked in this repo. This repository is public; check rather than assume.
git ls-files --error-unmatch $EnvFile 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Error "REFUSING: $EnvFile is tracked by git and this repo is public. Writing credentials into it would publish them on the next commit."
}
if (-not (Test-Path $EnvFile)) {
  Write-Error "REFUSING: $EnvFile not found. Run this from the repo root."
}

# -- The admin connection: read from file, never typed, never echoed ---------
$line = Select-String -Path $EnvFile, '.env' -Pattern '^DIRECT_URL=' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $line) { Write-Error "REFUSING: no DIRECT_URL found in $EnvFile or .env." }
$DirectUrl = ($line.Line -replace '^DIRECT_URL=', '').Trim().Trim('"').Trim("'")
if ([string]::IsNullOrWhiteSpace($DirectUrl)) { Write-Error 'REFUSING: DIRECT_URL is empty.' }

# Host only. Never print the whole URL - it carries neondb_owner's password.
$TargetHost = ($DirectUrl -replace '.*@', '') -replace '/.*', '' -replace ':.*', ''
Write-Output "Target host: $TargetHost"
$confirm = Read-Host 'Type the host again to confirm this is the database you mean'
if ($confirm -ne $TargetHost) { Write-Error 'Mismatch. Nothing was changed.' }

$psqlCmd = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlCmd) { Write-Error 'psql not found on PATH.' }

# -- Generate four independent passwords -------------------------------------
# .NET RNG rather than Get-Random, which is not cryptographically secure.
function New-StrongPassword {
  $bytes = New-Object byte[] 64
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  # Strip to alphanumerics so the value cannot collide with URL or psql syntax
  # when it is later embedded in a connection string.
  $s = [Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', ''
  if ($s.Length -lt 32) { throw 'password generation produced too few characters' }
  return $s.Substring(0, 32)
}

$AppPw = New-StrongPassword
$PltPw = New-StrongPassword
$MigPw = New-StrongPassword
$PrgPw = New-StrongPassword

# Distinctness is ASSERTED, not assumed - three roles sharing one password is
# precisely what went wrong the first time.
$all = @($AppPw, $PltPw, $MigPw, $PrgPw)
if (($all | Select-Object -Unique).Count -ne 4) {
  Write-Error 'REFUSING: generated passwords are not distinct.'
}

# -- Apply ---------------------------------------------------------------------
# Passed as psql variables and quoted server-side with %L, so no password ever
# appears in PowerShell history, in the process command line, or in a logged
# statement string. Single-quoted here-string: PowerShell does not interpolate,
# so $$ and :'app_pw' reach psql untouched.
$sql = @'
DO $$ BEGIN EXECUTE format('ALTER ROLE commish_app      LOGIN PASSWORD %L', :'app_pw'); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE commish_platform LOGIN PASSWORD %L', :'plt_pw'); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE commish_migrate  LOGIN PASSWORD %L', :'mig_pw'); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE commish_purge    LOGIN PASSWORD %L', :'prg_pw'); END $$;
'@

$sql | & psql $DirectUrl --no-psqlrc --quiet -v ON_ERROR_STOP=1 `
  -v "app_pw=$AppPw" -v "plt_pw=$PltPw" -v "mig_pw=$MigPw" -v "prg_pw=$PrgPw"

if ($LASTEXITCODE -ne 0) {
  Write-Error "psql exited $LASTEXITCODE - passwords were NOT set. Nothing written to $EnvFile."
}

# -- Write the two app URLs ----------------------------------------------------
# commish_purge deliberately gets NO url. It is the only role permitted to
# DELETE; if the web process can read its URL then "no application code issues
# DELETE" is one import away from being false. Its password is set and then
# discarded on purpose - re-run ALTER ROLE if the purge job ever needs it.
$PooledHost = $TargetHost -replace '^([^.]*)', '$1-pooler'
$DbName = ($DirectUrl -replace '.*/', '') -replace '\?.*', ''
$stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

$block = @(
  ''
  "# Commissioner OS role URLs - generated $stamp"
  '# commish_purge deliberately has NO url here. See the script header.'
  "COMMISH_APP_URL=`"postgresql://commish_app:$AppPw@$PooledHost/$DbName`?sslmode=require&pgbouncer=true`""
  "COMMISH_PLATFORM_URL=`"postgresql://commish_platform:$PltPw@$PooledHost/$DbName`?sslmode=require&pgbouncer=true`""
)
Add-Content -Path $EnvFile -Value $block -Encoding utf8

Remove-Variable AppPw, PltPw, MigPw, PrgPw -ErrorAction SilentlyContinue

Write-Output ''
Write-Output 'Done. Four roles now have LOGIN with distinct 32-character passwords.'
Write-Output "COMMISH_APP_URL and COMMISH_PLATFORM_URL appended to $EnvFile."
Write-Output ''
Write-Output 'commish_migrate had a password set but it was NOT written anywhere - it is'
Write-Output 'only needed if you point prisma migrate at that role. Re-run ALTER ROLE if so.'
Write-Output ''
Write-Output 'Verify (expect 4 rows, all True):'
Write-Output '  psql $env:DIRECT_URL -c "select rolname, rolcanlogin from pg_roles where rolname like ''commish\_%'' order by 1"'
