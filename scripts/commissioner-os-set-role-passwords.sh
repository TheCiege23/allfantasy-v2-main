#!/usr/bin/env bash
#
# Commissioner OS · give the four commish_* roles a LOGIN and a password.
#
# 🛑 WHY THIS IS A SCRIPT AND NOT FOUR LINES IN A README.
# The README version was four ALTER ROLE statements with placeholder values
# ('paste-a-generated-value-here', 'a-different-one'). On 2026-08-31 they were
# run verbatim against production. Every role got a guessable password, three of
# them got the SAME one, and all four values were sitting in plaintext in the
# conversation that produced them. Roles were reverted to NOLOGIN within minutes.
#
# A placeholder that is syntactically valid input is a trap, not an instruction.
# This script removes the opportunity: it generates the values itself, and there
# is nothing to fill in.
#
# WHAT IT DOES
#   1. generates four independent 32-byte passwords with openssl
#   2. ALTER ROLE ... LOGIN PASSWORD for each, over your existing DIRECT_URL
#   3. appends COMMISH_APP_URL and COMMISH_PLATFORM_URL to .env.local
#
# WHAT IT DELIBERATELY DOES NOT DO
#   - print any password to the terminal (they go straight into .env.local)
#   - write a COMMISH_PURGE_URL. commish_purge is the only role that may DELETE;
#     if the web process can read its URL, "no application code issues DELETE"
#     is one import away from being false. Its password is set and then dropped
#     on the floor on purpose — recover it with another ALTER ROLE if the purge
#     job ever needs it.
#
# USAGE
#   bash scripts/commissioner-os-set-role-passwords.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.local"

# ── Refuse to run if .env.local would be committed ───────────────────────────
# .gitignore has `.env*`, but an ALREADY-TRACKED file is not protected by a
# gitignore rule — that is how .env.example and .env.production stay tracked in
# this repo. This is a public repository; check rather than assume.
if git ls-files --error-unmatch "$ENV_FILE" >/dev/null 2>&1; then
  echo "REFUSING: $ENV_FILE is tracked by git and this repo is public." >&2
  echo "Writing credentials into it would publish them on the next commit." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "REFUSING: $ENV_FILE not found. Run from the repo root." >&2
  exit 1
fi

# ── The admin connection. Read from the file, never typed, never echoed. ─────
DIRECT_URL="$(grep -m1 '^DIRECT_URL=' "$ENV_FILE" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
if [ -z "$DIRECT_URL" ]; then
  echo "REFUSING: no DIRECT_URL found in $ENV_FILE or .env." >&2
  exit 1
fi

# Host only, so the operator can confirm the target without the credential
# appearing anywhere. Never print the whole URL — it carries a password.
TARGET_HOST="$(printf '%s' "$DIRECT_URL" | sed 's#.*@##; s#/.*##; s#:.*##')"
echo "Target host: $TARGET_HOST"
printf 'Type the host again to confirm this is the database you mean: '
read -r CONFIRM
if [ "$CONFIRM" != "$TARGET_HOST" ]; then
  echo "Mismatch. Nothing was changed." >&2
  exit 1
fi

command -v openssl >/dev/null || { echo "openssl not found" >&2; exit 1; }
command -v psql    >/dev/null || { echo "psql not found"    >&2; exit 1; }

APP_PW=$(openssl rand -base64 32 | tr -d '\n/+=' | cut -c1-32)
PLT_PW=$(openssl rand -base64 32 | tr -d '\n/+=' | cut -c1-32)
MIG_PW=$(openssl rand -base64 32 | tr -d '\n/+=' | cut -c1-32)
PRG_PW=$(openssl rand -base64 32 | tr -d '\n/+=' | cut -c1-32)

# Distinctness is asserted, not assumed — three roles sharing one password is
# exactly what went wrong the first time.
if [ "$APP_PW" = "$PLT_PW" ] || [ "$APP_PW" = "$MIG_PW" ] || [ "$APP_PW" = "$PRG_PW" ] \
   || [ "$PLT_PW" = "$MIG_PW" ] || [ "$PLT_PW" = "$PRG_PW" ] || [ "$MIG_PW" = "$PRG_PW" ]; then
  echo "REFUSING: generated passwords are not distinct." >&2
  exit 1
fi

# Passed as psql variables and quoted with %L server-side, so they never appear
# in shell history, in ps output, or in a logged statement string.
psql "$DIRECT_URL" --no-psqlrc --quiet -v ON_ERROR_STOP=1 \
  -v app_pw="$APP_PW" -v plt_pw="$PLT_PW" -v mig_pw="$MIG_PW" -v prg_pw="$PRG_PW" <<'SQL'
DO $$ BEGIN EXECUTE format('ALTER ROLE commish_app      LOGIN PASSWORD %L', :'app_pw'); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE commish_platform LOGIN PASSWORD %L', :'plt_pw'); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE commish_migrate  LOGIN PASSWORD %L', :'mig_pw'); END $$;
DO $$ BEGIN EXECUTE format('ALTER ROLE commish_purge    LOGIN PASSWORD %L', :'prg_pw'); END $$;
SQL

# ── Build the two app URLs from the admin URL, swapping role and password. ───
POOLED_HOST="$(printf '%s' "$TARGET_HOST" | sed 's#^\([^.]*\)#\1-pooler#')"
DBNAME="$(printf '%s' "$DIRECT_URL" | sed 's#.*/##; s#?.*##')"

{
  echo ""
  echo "# Commissioner OS role URLs — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# commish_purge deliberately has NO url here. See the script header."
  echo "COMMISH_APP_URL=\"postgresql://commish_app:${APP_PW}@${POOLED_HOST}/${DBNAME}?sslmode=require&pgbouncer=true\""
  echo "COMMISH_PLATFORM_URL=\"postgresql://commish_platform:${PLT_PW}@${POOLED_HOST}/${DBNAME}?sslmode=require&pgbouncer=true\""
} >> "$ENV_FILE"

unset APP_PW PLT_PW MIG_PW PRG_PW

echo
echo "Done. Four roles now have LOGIN with distinct 32-char passwords."
echo "COMMISH_APP_URL and COMMISH_PLATFORM_URL appended to $ENV_FILE."
echo
echo "commish_migrate's password was set and NOT written anywhere - it is only"
echo "needed if you point prisma migrate at that role. Re-run ALTER ROLE if so."
echo
echo "Verify (should print 4 rows, all t):"
echo "  psql \"\$DIRECT_URL\" -c \"select rolname, rolcanlogin from pg_roles where rolname like 'commish\\\\_%' order by 1\""
