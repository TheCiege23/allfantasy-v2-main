/**
 * Whether a league's stored variant marks it as an IDP league.
 *
 * ⚠ THE COMPARISON THIS REPLACES NEVER MATCHED A SINGLE LEAGUE. `LeagueShell` gated its IDP tab
 * on `leagueVariant === 'idp' || leagueVariant === 'dynasty_idp'`, and the value production
 * actually stores is `DYNASTY_IDP` — uppercase. All ten IDP leagues were flagged correctly in
 * the database and none of them ever saw the tab.
 *
 * ⚠ THIS IS A FLAG, AND `hasIdpScoring` IS THE GROUND TRUTH. The scoring predicate reads what a
 * league actually prices; this reads a column somebody set. They agree exactly on production
 * today — measured 2026-08-27, ten leagues by scoring, ten by variant, zero disagreeing in
 * either direction — which is what makes the flag safe to gate UI on. It lives here rather than
 * in `scoringNotes` because that module is `server-only` and this has to run in the shell.
 *
 * If the two ever diverge, the scoring is right and the flag is stale.
 */
export function isIdpLeagueVariant(variant: string | null | undefined): boolean {
  return /idp/i.test(String(variant ?? ''))
}
