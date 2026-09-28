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
 *   3. soccer's numeric id → that club's name on its Rolling Insights team row → 1 or 2.
 * No prefix or fuzzy matching: "Miami University" is not "Miami", and a wrong crest is worse than
 * the placeholder.
 */
import { prisma } from '@/lib/prisma'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'

/** Sources whose logos are real crests, best first. */
const LOGO_SOURCE_ORDER = ['thesportsdb', 'api_football', 'cfbd', 'api_sports', 'rolling_insights']

function exactKey(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Rolling Insights' formal college names that no suffix rule can reach, mapped to the name the
 * logo sources use. Checked on the EXACT name, before the loose rule — which is what makes
 * "Miami University" (Ohio) safe: loosely it is "miami", which is the Florida school.
 */
const COLLEGE_NAME_ALIASES: Record<string, string> = {
  'miami university': 'Miami (OH)',
  'united states naval academy': 'Navy',
  'united states military academy': 'Army',
  'united states air force academy': 'Air Force',
  'university of colorado boulder': 'Colorado',
  'university of north carolina at charlotte': 'Charlotte',
  'university of north carolina at chapel hill': 'North Carolina',
  'university of nebraska-lincoln': 'Nebraska',
  'university of southern mississippi': 'Southern Miss',
  'university of louisiana at monroe': 'Louisiana-Monroe',
  'university of louisiana at lafayette': 'Louisiana',
  'louisiana state university': 'LSU',
  'texas christian university': 'TCU',
  'university of central florida': 'UCF',
  'georgia institute of technology': 'Georgia Tech',
  'university of alabama at birmingham': 'UAB',
  'north carolina state university': 'NC State',
  'university of southern california': 'USC',
  'university of california, los angeles': 'UCLA',
  'university of california, berkeley': 'California',
  'university of california, davis': 'UC Davis',
  'the state university of new york at buffalo': 'Buffalo',
  'university at albany': 'UAlbany',
  'university of texas at el paso': 'UTEP',
  'university of texas at san antonio': 'UTSA',
  'university of texas at austin': 'Texas',
  'pennsylvania state university': 'Penn State',
  'university of nevada, las vegas': 'UNLV',
  'university of nevada, reno': 'Nevada',
  'university of illinois': 'Illinois',
  'university of wisconsin-madison': 'Wisconsin',
  'university of hawaii at manoa': "Hawai'i",
  'bowling green state university': 'Bowling Green',
  'middle tennessee state university': 'Middle Tennessee',
  'california state university, fresno': 'Fresno State',
  'california state university, sacramento': 'Sacramento State',
  'california polytechnic state university': 'Cal Poly',
  'brigham young university': 'BYU',
  'university of massachusetts': 'UMass',
  'university of connecticut': 'UConn',
  'university of mississippi': 'Ole Miss',
  'north carolina agricultural and technical state university': 'North Carolina A&T',
  'alabama agricultural and mechanical university': 'Alabama A&M',
  'virginia commonwealth university': 'VCU',
}

export function looseTeamKey(value: string | null | undefined): string {
  return exactKey(value)
    .replace(/&/g, ' and ')
    .replace(/[.'’]/g, '')
    .replace(/[(),–-]/g, ' ')
    .replace(/^the /, '')
    .replace(/^university of /, '')
    .replace(/ university$/, '')
    .replace(/ college$/, '')
    .replace(/^(afc|fc|cf|ac) /, '')
    .replace(/ (afc|fc|cf|sc)$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

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
    const value = COLLEGE_NAME_ALIASES[exactKey(raw)] ?? raw
    const direct = byName(value)
    if (direct) return direct
    if (/^\d+$/.test(value)) {
      const name = nameByRiId.get(value)
      return name ? byName(name) : null
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
