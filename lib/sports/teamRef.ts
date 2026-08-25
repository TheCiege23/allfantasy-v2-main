import { NFL_TEAMS, resolveTeam } from '@/lib/sports-data-gateway/teamIdentity'

/**
 * ONE TEAM REFERENCE, WHATEVER SHAPE IT ARRIVES IN.
 *
 * ⚠ `SportsGame.homeTeam` IS NOT ONE FORMAT. Measured 2026-08-25 for NFL 2026,
 * the same fixture is stored once PER SOURCE and the sources disagree:
 *
 *   rolling_insights  421 rows — mixes BOTH ("ARI" … "Washington Commanders")
 *   thesportsdb       324 rows — full names ("Arizona Cardinals")
 *   espn               32 rows — full names
 *   espn_live          16 rows — abbreviations ("ARI", "TEN")
 *
 * A roster carries `JAX`. Matching that against `homeTeam` directly hits two
 * sources and silently misses the other two.
 *
 * ⚠ THE CERTIFIED RESOLVER STAYS CERTIFIED. `resolveTeam` in
 * `sports-data-gateway/teamIdentity` deliberately refuses a display name or a
 * city on its own, because for ITS job — bridging provider ids — a loose match is
 * a wrong team. That stance is right and this module does not relax it: it tries
 * the certified path FIRST and only then falls back to full-name matching, which
 * is safe here for one narrow reason spelled out below.
 */

export type CanonicalTeamId = string

/**
 * Nickname alone is sufficient in the NFL, and only in the NFL: all 32 nicknames
 * are distinct (there is one Cardinals, one Giants, one Jets). That is what makes
 * a name fallback safe here and what would make it unsafe if this were extended
 * to college, where nicknames repeat constantly.
 */
const NFL_BY_NAME = new Map<string, CanonicalTeamId>()
for (const t of NFL_TEAMS) {
  const full = `${t.city ?? ''} ${t.currentName}`.trim().toUpperCase()
  NFL_BY_NAME.set(full, t.canonicalTeamId)
  NFL_BY_NAME.set(t.currentName.toUpperCase(), t.canonicalTeamId)
}

/**
 * Resolve any NFL team reference — abbreviation, alias, provider id, or full
 * display name — to one canonical id. Returns null when it cannot be certain;
 * a wrong team is worse than an unknown one.
 */
export function resolveNflTeamRef(ref: string | null | undefined, provider = 'sleeper'): CanonicalTeamId | null {
  const raw = (ref ?? '').trim()
  if (raw === '') return null

  // 1. The certified path: provider ids, abbreviations, aliases, relocations.
  const certified = resolveTeam({ provider, ref: raw, sport: 'NFL' })
  if (certified.status === 'resolved') return certified.canonicalTeamId

  // 2. Display name, which the certified resolver refuses by design.
  const hit = NFL_BY_NAME.get(raw.toUpperCase())
  return hit ?? null
}

/** Do two references point at the same franchise? Null refs never match. */
export function sameNflTeam(a: string | null | undefined, b: string | null | undefined): boolean {
  const ra = resolveNflTeamRef(a)
  const rb = resolveNflTeamRef(b)
  return ra != null && rb != null && ra === rb
}

/**
 * Fixture identity that survives the same game being stored once per source.
 * `externalId` cannot do this — it differs BY source, which is what produces the
 * duplicate rows in the first place.
 */
export function nflFixtureKey(args: {
  homeTeam: string | null | undefined
  awayTeam: string | null | undefined
  startTime: Date | null | undefined
  week: number | null | undefined
  season: number | null | undefined
}): string | null {
  const home = resolveNflTeamRef(args.homeTeam)
  const away = resolveNflTeamRef(args.awayTeam)
  if (!home || !away) return null
  /*
   * Keyed on the calendar day rather than the timestamp: sources disagree on
   * kickoff by minutes, and two rows for one fixture must collapse.
   */
  const day = args.startTime ? args.startTime.toISOString().slice(0, 10) : `w${args.week ?? '?'}`
  return `${args.season ?? '?'}:${day}:${home}:${away}`
}
