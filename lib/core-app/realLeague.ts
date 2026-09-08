/**
 * One row per REAL league, not per import of it.
 *
 * ── The shape of the problem ────────────────────────────────────────────────
 *
 * `leagues.userId` is the IMPORTER, so one Sleeper league exists once per member
 * who connected it — KBFL exists three times because three of its managers
 * imported it. A reader who belongs to several of those copies sees the same
 * league several times on any surface keyed on `leagueTeam.claimedByUserId`.
 *
 * 🛑 IT IS NOT A REPEATED IMPORT, AND THAT MATTERS FOR WHERE THE FIX GOES.
 * Measured on production 2026-09-08 across all 287 AF league rows: 23 real
 * leagues have more than one row, and for EVERY ONE of them the rows belong to
 * DIFFERENT users. Same user + same platformLeagueId occurs ZERO times. The
 * importer upserts correctly; pressing import twenty times does not make twenty
 * leagues. It is the READ that counts views of one league as separate leagues,
 * so the read is where this is fixed.
 *
 * For the account that reported it: 94 claimed teams across 65 real leagues,
 * 21 leagues held under more than one row, 29 duplicate rows on any such board.
 *
 * ⚠ THIS IS THE ONE IMPLEMENTATION OF THAT RULE. `lib/core-app/portfolio.ts`
 * previously carried its own private copy, and two implementations of one rule
 * is a bug this repo has paid for before — they had already diverged, since the
 * portfolio copy omitted `platform` from the key. Everything below is the union
 * of the two, and callers supply only the part that is genuinely theirs: which
 * copy to prefer.
 *
 * ⚠ NO PRISMA AND NO `server-only` HERE, ON PURPOSE. Pure, so it is unit
 * testable and cannot drag a database import into a client bundle — the barrel
 * trap that broke the build on 2026-09-07.
 */

export type RealLeagueIdentity = {
  platform?: string | null
  platformLeagueId?: string | null
  /**
   * ⚠ PART OF THE KEY BECAUSE SOME PROVIDERS REUSE A LEAGUE ID ACROSS YEARS.
   * Merging two seasons of one league would silently hide a whole season, which
   * is a worse failure than the duplicate this function exists to remove.
   */
  season?: number | string | null
  leagueId: string
}

/**
 * A stable key for the league as it exists in the world, rather than as a row.
 *
 * 🛑 THE MISSING-ID CASE IS THE DANGEROUS ONE. A manual or unlinked league has
 * no `platformLeagueId`. Keying those on the null would give every one of them
 * the SAME key and collapse all manual leagues into a single row — turning a
 * de-duplication into a silent mass disappearance. No provider id means no
 * evidence two rows are the same thing, so the AF row IS the identity.
 *
 * ⚠ AND `platform` IS IN THE KEY. Provider ids are unique only within a
 * provider; Sleeper 123 and ESPN 123 are two different leagues. The portfolio
 * copy of this rule omitted it.
 */
export function realLeagueKey(l: RealLeagueIdentity): string {
  const pid = String(l.platformLeagueId ?? '').trim()
  if (!pid) return `af:${l.leagueId}`
  const platform = String(l.platform ?? '').trim().toLowerCase()
  const season = String(l.season ?? '').trim()
  return `${platform}:${pid}::${season}`
}

/**
 * Collapse rows describing the same real league, keeping the one the caller
 * prefers.
 *
 * `preferIncoming(incoming, held)` returns true when `incoming` should replace
 * the row already kept. It is the caller's, because the right answer differs by
 * surface: the portfolio prefers the copy the reader imported themselves and
 * then the one with a roster behind it (the other is a view they cannot act
 * on), while a ranked board prefers the stronger recommendation.
 *
 * ⚠ A TIE MUST RESOLVE THE SAME WAY EVERY TIME. If `preferIncoming` is
 * indifferent the FIRST row wins, so callers should make their comparator total
 * — otherwise the surface can show a different copy between two loads of
 * identical data, which reads as flicker and cannot be reproduced from a bug
 * report.
 *
 * Input order is preserved; callers sort afterwards.
 */
export function keepBestPerRealLeague<T>(
  rows: readonly T[],
  identify: (row: T) => RealLeagueIdentity,
  preferIncoming: (incoming: T, held: T) => boolean,
): T[] {
  const at = new Map<string, number>()
  const kept: T[] = []

  for (const row of rows) {
    const key = realLeagueKey(identify(row))
    const i = at.get(key)
    if (i === undefined) {
      at.set(key, kept.length)
      kept.push(row)
      continue
    }
    if (preferIncoming(row, kept[i])) kept[i] = row
  }

  return kept
}

/** How many distinct real leagues a set of rows covers. */
export function countRealLeagues(rows: readonly RealLeagueIdentity[]): number {
  return new Set(rows.map(realLeagueKey)).size
}
