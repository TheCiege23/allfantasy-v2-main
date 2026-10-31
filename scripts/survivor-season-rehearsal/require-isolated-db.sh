#!/usr/bin/env bash
# Refuse anything but the isolated staging-survivor-season branch. Run by every job of
# .github/workflows/survivor-season-rehearsal.yml before it touches a database, with the secret in $URL.
# Reasons go out as ::error:: annotations, which are readable where the job log is not. The value
# itself is never printed; only which rule it broke.
set -u
if [ -z "${URL:-}" ]; then echo "::error::SURVIVOR_REHEARSAL_DATABASE_URL is empty or not a repository Actions secret."; exit 1; fi
case "$URL" in postgres://*|postgresql://*) ;; *) echo "::error::The secret does not start with postgresql:// (check for quotes or a psql command around it)."; exit 1;; esac
case "$URL" in *ep-curly-block-ad0dlt9o*) echo "::error::Refusing the production endpoint."; exit 1;; esac
case "$URL" in *ep-old-queen-ade7otjh*) ;; *) echo "::error::The secret is not the staging-survivor-season branch (endpoint ep-old-queen-ade7otjh)."; exit 1;; esac
DB=$(printf '%s' "$URL" | sed -E 's#^[^/]*//[^/]*/([^?]*).*#\1#')
if [ "$DB" != "neondb" ]; then echo "::error::The secret names database '$DB'; it must be 'neondb' (the branch's current schema). Change the path after the host to /neondb."; exit 1; fi
echo "::notice::Isolated connection accepted (staging-survivor-season branch, database neondb)."
