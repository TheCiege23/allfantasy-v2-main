/**
 * The one CollegeFootballData base URL.
 *
 * Six files each held their own copy of this literal (`CFBD_BASE`,
 * `CFBD_BASE_URL`, or inline), which is six places to edit if the host ever
 * moves — exactly the drift that had ESPN answering from a stale host across 18
 * call sites.
 *
 * ⚠ HOISTING A PROVIDER URL INTO A CONSTANT HIDES IT FROM THE DB-FIRST GUARD.
 * The guard finds direct provider calls by scanning for `https://` literals, so
 * the moment the literal lives here, every consumer goes quiet. That is why
 * `CFBD_BASE_URL` is listed in `DATA_API_IDENTIFIERS` in
 * `scripts/check-db-first-api-boundary.mjs`: the identifier is matched as if it
 * were the URL it stands for. Consolidating without that entry would have
 * retired the check for all six files in one commit — the ESPN lesson written
 * up in that script.
 *
 * This module deliberately contains NOTHING but the constant. It is a URL
 * definition site, not a client: no fetch, no key, nothing to allowlist.
 */
export const CFBD_BASE_URL = 'https://api.collegefootballdata.com'
