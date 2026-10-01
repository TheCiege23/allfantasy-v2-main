/**
 * Picks which provider search result a headshot belongs to — or refuses to pick.
 *
 * Both name-search headshot providers (`thesportsdb`, `api-sports`) used to end their match with
 * `?? rows[0]`: when nothing matched the name, the FIRST search result's photo was returned
 * anyway, and the resolver persisted it as that player's headshot. TheSportsDB's search is not
 * scoped to a sport either. Measured in production 2026-10-01: 163 NBA/MLB/NHL/NCAAB/soccer
 * players carried an `api-sports.io/american-football` photo — a different person from a
 * different sport — and ~90 more URLs were shared by players with different names.
 *
 * The rule here is deliberately conservative, because a missing headshot renders the UI's
 * initials fallback and a wrong one shows a stranger's face:
 *   1. the candidate's name must match the searched name (punctuation, case and Jr/Sr/II-style
 *      suffixes ignored);
 *   2. team only BREAKS TIES between same-named candidates — a lone name match is accepted
 *      even when its team differs, since provider rosters lag trades;
 *   3. two or more same-named candidates that team cannot separate → no pick.
 *
 * Sport scoping is the caller's job, because only the caller knows its provider's sport field.
 */

/**
 * Strip punctuation, lowercase, remove suffixes (Jr/Sr/II/III/IV/V),
 * collapse whitespace. Used for safe name comparisons across providers.
 */
export function normalizePlayerName(name: string | null | undefined): string {
  if (!name) return ''
  let s = String(name).trim().toLowerCase()
  // Strip apostrophes, hyphens, periods entirely.
  s = s.replace(/['‘’`.,]/g, '')
  s = s.replace(/-/g, ' ')
  // Drop common suffixes after the last space.
  s = s.replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
  // Collapse repeated whitespace, trim.
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/**
 * `normalizePlayerName` with spaces removed. The resolver searches several spellings of one
 * name ("Ja'Marr Chase", "Ja Marr Chase", "jamarr chase"); this makes every one of them
 * compare equal to the provider's "Ja'Marr Chase" without loosening the match any further.
 */
export function compactPlayerName(name: string | null | undefined): string {
  return normalizePlayerName(name).replace(/\s+/g, '')
}

export function pickHeadshotCandidate<T>(
  rows: readonly T[],
  opts: {
    search: string
    nameOf: (row: T) => string | null | undefined
    teamCodeOf: (row: T) => string | null | undefined
    teamCode?: string | null
  },
): T | null {
  const wanted = compactPlayerName(opts.search)
  if (!wanted) return null

  const named = rows.filter((row) => compactPlayerName(opts.nameOf(row)) === wanted)
  if (named.length === 0) return null

  const teamCode = (opts.teamCode ?? '').trim().toUpperCase()
  if (teamCode) {
    const sameTeam = named.filter(
      (row) => (opts.teamCodeOf(row) ?? '').trim().toUpperCase() === teamCode,
    )
    if (sameTeam.length === 1) return sameTeam[0]!
    if (sameTeam.length > 1) return null
  }

  return named.length === 1 ? named[0]! : null
}
