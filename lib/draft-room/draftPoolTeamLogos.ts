/**
 * Team logos for the draft pool, from the team rows we have already ingested (`SportsTeam.logo`).
 *
 * 🛑 The pool used to take every logo from the static registry, which never returns empty: a
 * value it does not know becomes an ESPN URL built from the raw string. Outside NFL the pool's team
 * value is not an abbreviation — Rolling Insights sends "Memphis Grizzlies", "Auburn University",
 * or, for soccer, a numeric team id — so those became `nba/500/memphisgrizzlies.png` and 404'd into
 * a blank badge. Measured on the test DB 2026-09-24: stored logos exist for every NBA, MLB, NHL and
 * NFL team (and match the pool's team names exactly), ~870 college football, ~380 college
 * basketball and the English Premier League.
 *
 * Matching, strictest first:
 *   1. exact name / short name / "city name" (all pro leagues);
 *   2. the same after dropping "University of", "University", "College", "FC" and punctuation
 *      (college and soccer naming differs by source);
 *   3. soccer's numeric id → that club's name on its Rolling Insights team row → 1 or 2;
 *   4. for a college name that still missed, CFBD's spelling and then the logo-only spellings
 *      (`collegeLogoNameCandidates`) — tried after 1–3, so they fill blanks and never move a crest.
 *      Measured 2026-10-01 on the test DB: 1,065 college football and 2,368 college basketball
 *      players had no crest; every school with a stored crest under any spelling is now reached.
 * No prefix or fuzzy matching: "Miami University" is not "Miami", and a wrong crest is worse than
 * the placeholder.
 */
import { prisma } from '@/lib/prisma'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import { collegeLogoNameCandidates, exactKey, looseTeamKey } from '@/lib/sports-data/collegeTeamNames'

// Re-exported: callers imported it from here before the crosswalk moved to its own module.
export { looseTeamKey }

/** Sources whose logos are real crests, best first. */
const LOGO_SOURCE_ORDER = ['thesportsdb', 'api_football', 'cfbd', 'api_sports', 'rolling_insights']

type TeamRow = {
  externalId: string
  name: string
  shortName: string | null
  city: string | null
  logo: string | null
  source: string
}

/** Build a resolver from team rows — exported so it can be tested without a database. */
export function buildTeamLogoResolver(rows: readonly TeamRow[]): (team: string | null | undefined) => string | null {
  const rank = (source: string) => {
    const i = LOGO_SOURCE_ORDER.indexOf(source)
    return i === -1 ? LOGO_SOURCE_ORDER.length : i
  }
  const exact = new Map<string, { url: string; rank: number }>()
  const loose = new Map<string, { url: string; rank: number } | 'ambiguous'>()
  const put = (key: string, url: string, r: number) => {
    if (!key) return
    const cur = exact.get(key)
    if (!cur || r < cur.rank) exact.set(key, { url, rank: r })
  }
  const putLoose = (key: string, url: string, r: number) => {
    if (!key) return
    const cur = loose.get(key)
    if (cur === 'ambiguous') return
    if (!cur) return void loose.set(key, { url, rank: r })
    if (cur.url === url) return
    // Two different crests under one loose name is a collision, unless one source outranks.
    if (r < cur.rank) loose.set(key, { url, rank: r })
    else if (r === cur.rank) loose.set(key, 'ambiguous')
  }
  for (const row of rows) {
    if (!row.logo || !/^https?:\/\//i.test(row.logo)) continue
    const r = rank(row.source)
    for (const v of [row.name, row.shortName, row.city ? `${row.city} ${row.name}` : null]) {
      put(exactKey(v), row.logo, r)
      putLoose(looseTeamKey(v), row.logo, r)
    }
  }
  // Soccer rows carry a Rolling Insights team id in place of a name.
  const nameByRiId = new Map<string, string>()
  for (const row of rows) {
    if (row.source === 'rolling_insights' && row.externalId) nameByRiId.set(row.externalId.trim(), row.name)
  }

  const byName = (value: string): string | null => {
    const hit = exact.get(exactKey(value))
    if (hit) return hit.url
    const l = loose.get(looseTeamKey(value))
    return l && l !== 'ambiguous' ? l.url : null
  }

  return (team) => {
    const raw = String(team ?? '').trim()
    if (!raw) return null
    const [value, ...fallbacks] = collegeLogoNameCandidates(raw)
    const direct = byName(value)
    if (direct) return direct
    if (/^\d+$/.test(value)) {
      const name = nameByRiId.get(value)
      return name ? byName(name) : null
    }
    for (const name of fallbacks) {
      const hit = byName(name)
      if (hit) return hit
    }
    return null
  }
}

export async function loadDraftPoolTeamLogoResolver(
  sport: string,
): Promise<(team: string | null | undefined) => string | null> {
  // Logos are decoration: no stored crests (or no table) leaves each entry's own logo in place and
  // must never fail the pool. A try, not only `.catch`, so a synchronous throw is caught too.
  let rows: TeamRow[] = []
  try {
    rows = await prisma.sportsTeam.findMany({
      where: { sport: String(sport).toUpperCase() },
      select: { externalId: true, name: true, shortName: true, city: true, logo: true, source: true },
      take: 5000,
    })
  } catch {
    rows = []
  }
  return buildTeamLogoResolver(rows)
}

/** Put the stored crest on each entry that has one; entries without a match keep what they had. */
export function applyStoredTeamLogos(
  entries: NormalizedDraftEntry[],
  resolve: (team: string | null | undefined) => string | null,
): NormalizedDraftEntry[] {
  for (const entry of entries) {
    const url = resolve(entry.team) ?? resolve(entry.display?.team?.displayName)
    if (!url) continue
    // A copy: `resolvePlayerAssets` hands out the object it caches, so mutating it in place would
    // rewrite the cache entry every other request reads.
    if (entry.display?.assets) {
      entry.display.assets = { ...entry.display.assets, teamLogoUrl: url, teamLogoFallbackUsed: false }
    }
    const team = entry.display?.team
    if (team) {
      team.logoUrl = url
      team.logoFallbackUsed = false
    }
  }
  return entries
}
