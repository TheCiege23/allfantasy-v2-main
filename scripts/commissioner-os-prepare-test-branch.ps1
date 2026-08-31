<#
  Commissioner OS - prepare a NON-PRODUCTION branch for the acceptance suites.

  The eleven __tests__/commissioner-os/*.spec.ts suites need FIVE connection
  URLs, each connecting as a different role:

      DIRECT_URL             owner  (schema inspection, seeding)
      COMMISH_MIGRATE_URL    commish_migrate
      COMMISH_APP_URL        commish_app
      COMMISH_PLATFORM_URL   commish_platform
      COMMISH_PURGE_URL      commish_purge

  🛑 THIS IS NOT THE SAME JOB AS PROVISIONING PRODUCTION, WHICH IS WHY IT IS A
  SEPARATE SCRIPT. commissioner-os-set-role-passwords.ps1 deliberately writes
  only APP and PLATFORM and withholds PURGE entirely - if the web process can
  read the purge URL, "no application code issues DELETE" is one import away
  from being false. That withholding is correct for production and would simply
  make the purge suite unrunnable here. Reusing that script for this would have
  meant weakening it.

  🛑 AND IT REFUSES TO RUN AGAINST PRODUCTION, BY MEASUREMENT NOT BY TRUST.
  These suites seed tenants and CREATE TABLE scratch probes. On 2026-08-31 they
  were once pointed at production by accident and were saved only because the
  roles and tables did not exist yet - every suite died at its first assertion.
  That accident is no longer survivable: production now HAS the roles and the
  tables, so the same mistake would write. The guard below compares the target
  host against the production host read from .env, and stops.

  USAGE
    powershell -ExecutionPolicy Bypass -File scripts/commissioner-os-prepare-test-branch.ps1 -BranchUrl "<branch connection string>"

  Get <branch connection string> from the Neon console: select the branch, then
  "Connect" / "Connection string", role neondb_owner, and copy it whole.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $BranchUrl,

  [string] $OutFile = '.env.commish-test',

  # Skip the interactive confirmation. The production-endpoint guard above is
  # NOT skippable and still runs - this only silences the "look at the target"
  # prompt, which is useless in a non-interactive shell.
  [switch] $Yes
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Get-HostFrom([string] $url) {
  return (($url -replace '.*@', '') -replace '/.*', '') -replace ':.*', ''
}

# -- Reject a placeholder before anything else -------------------------------
# 🛑 THIS IS THE THIRD TIME A PLACEHOLDER HAS BEEN RUN AS IF IT WERE A VALUE in
# this project: 'paste-a-generated-value-here' and 'a-different-one' became real
# production role passwords, and then '<paste the string here>' was passed here
# as a connection string. In every case the tool accepted it happily, because a
# placeholder that is syntactically valid input is indistinguishable from input.
#
# The lesson is not "read the instructions more carefully". It is that any
# argument a human is told to substitute MUST be validated for the shape it is
# supposed to have, or the substitution step is optional in practice.
if ($BranchUrl -match '[<>]' -or $BranchUrl -match '^\s*$') {
  Write-Error "REFUSING: -BranchUrl looks like an unsubstituted placeholder ('$BranchUrl'). Paste the real connection string from the Neon console."
}
if ($BranchUrl -notmatch '^postgres(ql)?://[^:/@\s]+:[^@\s]+@[^/@\s]+/[^?\s]+') {
  Write-Error "REFUSING: -BranchUrl is not a Postgres connection string. Expected postgresql://USER:PASSWORD@HOST/DATABASE - copy it whole from the Neon console's Connect dialog."
}

$BranchHost = Get-HostFrom $BranchUrl
if ([string]::IsNullOrWhiteSpace($BranchHost)) {
  Write-Error "REFUSING: could not parse a host out of -BranchUrl."
}
# A Neon endpoint host, not something that merely parsed. Catches a URL that is
# well-formed but points somewhere unexpected.
if ($BranchHost -notmatch '\.neon\.tech$') {
  Write-Error "REFUSING: host '$BranchHost' is not a *.neon.tech endpoint."
}

# 🛑 THE DIRECT HOST, NOT THE POOLER. This script runs ALTER ROLE - admin DDL -
# and Neon's pooled endpoint is PgBouncer in transaction mode. Against the pooled
# host the ALTER is refused with a message that points at the wrong thing
# entirely:
#
#   ERROR:  permission denied to alter role
#   DETAIL: Only roles with the CREATEROLE attribute and the ADMIN option on
#           role "commish_app" may alter this role.
#
# Measured on 2026-08-31: the SAME statement, as the SAME role (neondb_owner,
# rolcreaterole=true, admin_option=true on commish_app), SUCCEEDS on the direct
# host and is refused through the pooler. So the DETAIL line is misleading -
# nothing is wrong with the role's privileges, and following that message leads
# into pg_auth_members instead of at the hostname.
#
# LOCAL-SETUP.md already says direct-for-migrations, pooled-for-the-app. This
# makes it enforced rather than documented.
# A Neon branch holds several databases and the Connect dialog remembers the last
# one selected. `mydb_shadow` is Prisma's shadow database - empty by design - and
# `postgres` is the cluster default. Both parse fine and connect fine; they simply
# contain none of the schema, which surfaces much later as
# `relation "_prisma_migrations" does not exist`. Catch it here, by name, before
# a connection is even opened.
$UrlDb = ($BranchUrl -replace '.*/', '') -replace '\?.*', ''
if ($UrlDb -in @('mydb_shadow', 'postgres', 'template1')) {
  Write-Error "REFUSING: the connection string names database '$UrlDb', which holds none of the application schema. mydb_shadow is Prisma's shadow database and postgres is the cluster default. Re-copy the string with the application database selected (normally 'neondb') in the Neon Connect dialog's Database dropdown."
}

if ($BranchHost -match '-pooler\.') {
  $direct = $BranchHost -replace '-pooler\.', '.'
  Write-Error "REFUSING: '$BranchHost' is the POOLED endpoint. Admin statements (ALTER ROLE) do not work through Neon's pooler and fail with a misleading 'permission denied to alter role'. Use the direct host instead: $direct  (In the Neon Connect dialog, turn OFF 'Connection pooling'.)"
}

# -- The production-host guard ------------------------------------------------
# Read the production host from the repo's own env files rather than hardcoding
# it, so this keeps working if the project moves.
$prodLine = Select-String -Path '.env.local', '.env' -Pattern '^DIRECT_URL=' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($prodLine) {
  $prodUrl = ($prodLine.Line -replace '^DIRECT_URL=', '').Trim().Trim('"').Trim("'")
  $prodHost = Get-HostFrom $prodUrl
  if ($BranchHost -eq $prodHost) {
    Write-Error "REFUSING: -BranchUrl points at the PRODUCTION host ($prodHost). These suites seed tenants and CREATE TABLE. Create a Neon branch and pass its URL."
  }
  # Neon pooled and direct hosts differ only by a '-pooler' segment; compare the
  # endpoint id too, or passing the pooled production URL would sail past.
  $bEp = ($BranchHost -split '\.')[0] -replace '-pooler$', ''
  $pEp = ($prodHost  -split '\.')[0] -replace '-pooler$', ''
  if ($bEp -eq $pEp) {
    Write-Error "REFUSING: -BranchUrl resolves to the same Neon endpoint as production ($pEp)."
  }
} else {
  Write-Warning 'No DIRECT_URL found in .env.local/.env - cannot compare against production. Continuing only because there is nothing to compare to.'
}

Write-Output "Target branch host: $BranchHost"

# ⚠ ACCEPT EITHER THE HOST OR THE WHOLE URL, and normalise before comparing.
# The first version demanded an exact match on the host and rejected the obvious
# thing to paste - the connection string that is already on the clipboard. It
# then reported only "Mismatch. Nothing was changed.", printing neither value, so
# there was nothing to see. A confirmation step that is hard to satisfy correctly
# does not add safety; it trains people to bypass it.
#
# The real protection here is the production-endpoint guard above, which is
# mechanical. This prompt only exists to make the operator LOOK at the target.
if ($Yes) {
  Write-Output 'Confirmation skipped (-Yes).'
} else {
  $confirm = Read-Host 'Paste the host (or the whole connection string) again to confirm'
  $confirmHost = $confirm.Trim().Trim('"').Trim("'")
  if ($confirmHost -match '@') { $confirmHost = Get-HostFrom $confirmHost }
  if ($confirmHost -ne $BranchHost) {
    Write-Error "Mismatch. Nothing was changed.`n  expected: $BranchHost`n  got:      $confirmHost`n(Hosts are not secret - compare them and re-run, or pass -Yes to skip this prompt.)"
  }
}

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { Write-Error 'psql not found on PATH.' }

# -- Generate four distinct passwords ----------------------------------------
function New-StrongPassword {
  $bytes = New-Object byte[] 64
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $s = [Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', ''
  if ($s.Length -lt 32) { throw 'password generation produced too few characters' }
  return $s.Substring(0, 32)
}
$AppPw = New-StrongPassword; $PltPw = New-StrongPassword
$MigPw = New-StrongPassword; $PrgPw = New-StrongPassword
if ((@($AppPw,$PltPw,$MigPw,$PrgPw) | Select-Object -Unique).Count -ne 4) {
  Write-Error 'REFUSING: generated passwords are not distinct.'
}

# ⚠ Bare :'var', never inside DO $$ ... $$ - psql does not interpolate a variable
# inside a quoted literal, and a dollar-quoted string is one. That exact mistake
# produced `syntax error at or near ":"` against production earlier today.
$sql = @'
-- 🛑 FINGERPRINT THE TARGET BEFORE TOUCHING IT.
-- "Not production" is not the same question as "the right branch". On
-- 2026-08-31 a connection string was copied for a DIFFERENT branch of the same
-- project - the Neon console's Connect dialog remembers whatever was selected
-- last - and the production guard correctly waved it through, because it really
-- was not production. The run then failed deep inside ALTER ROLE with
-- "permission denied to alter role", which says nothing about the actual
-- mistake and sends you looking at privileges instead of at the host.
--
-- A branch that can run these suites has a specific shape: the four commish_*
-- roles, and the seven Commissioner OS migrations recorded. Assert it, and say
-- plainly what is wrong when it does not hold.
DO $fingerprint$
DECLARE
  n_roles int;
  n_migrations int;
  dbs text;
BEGIN
  -- ⚠ CHECK THE DATABASE BEFORE QUERYING ITS TABLES. A Neon branch holds several
  -- databases (here: neondb, mydb_shadow, postgres) and the Connect dialog has a
  -- database selector that remembers its last value. Point at the wrong one and
  -- the fingerprint query itself explodes:
  --
  --   ERROR:  relation "_prisma_migrations" does not exist
  --
  -- which is true, unhelpful, and says nothing about the database being wrong.
  -- Probe with to_regclass, which returns NULL instead of raising, so the script
  -- can explain rather than crash.
  IF to_regclass('public._prisma_migrations') IS NULL THEN
    SELECT string_agg(datname, ', ' ORDER BY datname) INTO dbs
      FROM pg_database WHERE NOT datistemplate;
    RAISE EXCEPTION
      'Connected to database "%" on this branch, which has no _prisma_migrations table - so it is almost certainly the WRONG DATABASE, not the wrong branch. Databases here: %. The application database is the one carrying the schema (normally "neondb"); mydb_shadow is Prisma''s shadow database and is empty by design. Re-copy the connection string with the right database selected.',
      current_database(), dbs;
  END IF;

  SELECT count(*) INTO n_roles      FROM pg_roles WHERE rolname LIKE 'commish\_%';
  SELECT count(*) INTO n_migrations FROM _prisma_migrations
   WHERE migration_name LIKE '%commissioner_os%' AND finished_at IS NOT NULL;

  IF n_roles <> 4 OR n_migrations < 7 THEN
    RAISE EXCEPTION
      'Database "%" is not a prepared Commissioner OS branch: % commish_* roles (need 4), % applied Commissioner OS migrations (need >= 7). Most likely the connection string is for the WRONG BRANCH - the Neon Connect dialog defaults to the last branch you looked at. Re-copy it from the branch page itself.',
      current_database(), n_roles, n_migrations;
  END IF;
END
$fingerprint$;

ALTER ROLE commish_app      LOGIN PASSWORD :'app_pw';
ALTER ROLE commish_platform LOGIN PASSWORD :'plt_pw';
ALTER ROLE commish_migrate  LOGIN PASSWORD :'mig_pw';
ALTER ROLE commish_purge    LOGIN PASSWORD :'prg_pw';
'@

$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $sql | & psql $BranchUrl --no-psqlrc --quiet -v ON_ERROR_STOP=1 `
    -v "app_pw=$AppPw" -v "plt_pw=$PltPw" -v "mig_pw=$MigPw" -v "prg_pw=$PrgPw"
  $psqlExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $prev }

if ($psqlExit -ne 0) { Write-Error "psql exited $psqlExit - nothing written to $OutFile." }

# -- Write all five URLs ------------------------------------------------------
# A dedicated file, NOT .env.local: these point at a throwaway branch and must
# never become the app's configuration by being sitting in the file next.js reads.
$PooledHost = $BranchHost -replace '^([^.]*)', '$1-pooler'
$DbName = ($BranchUrl -replace '.*/', '') -replace '\?.*', ''
$q = '?sslmode=require'

@(
  "# Commissioner OS acceptance-suite URLs - THROWAWAY BRANCH ONLY"
  "# Generated $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')) for $BranchHost"
  "# Do NOT copy these into .env.local. Delete the branch when finished."
  "DIRECT_URL=`"$BranchUrl`""
  "DATABASE_URL=`"$BranchUrl`""
  "COMMISH_MIGRATE_URL=`"postgresql://commish_migrate:$MigPw@$BranchHost/$DbName$q`""
  "COMMISH_APP_URL=`"postgresql://commish_app:$AppPw@$PooledHost/$DbName$q&pgbouncer=true`""
  "COMMISH_PLATFORM_URL=`"postgresql://commish_platform:$PltPw@$PooledHost/$DbName$q&pgbouncer=true`""
  "COMMISH_PURGE_URL=`"postgresql://commish_purge:$PrgPw@$BranchHost/$DbName$q`""
) | Set-Content -Path $OutFile -Encoding utf8

Remove-Variable AppPw, PltPw, MigPw, PrgPw -ErrorAction SilentlyContinue

Write-Output ''
Write-Output "Wrote five URLs to $OutFile (throwaway branch only)."
Write-Output ''
Write-Output 'Now run the acceptance suites:'
Write-Output ''
Write-Output '  powershell -ExecutionPolicy Bypass -File scripts/commissioner-os-run-acceptance.ps1'
Write-Output ''
