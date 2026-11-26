import { prisma } from '@/lib/prisma'
import { createTtlMemo } from '@/lib/ttl-memo'
import {
  collegeSchoolFilter,
  isCollegeScopeSport,
  readCollegeConferenceScope,
  type CollegeConferenceScope,
  type CollegeScopeSport,
} from '@/lib/college/conferenceScope'

/** The league's conference scope, or null for every school (and for any non-college league). */
export async function loadLeagueCollegeScope(
  leagueId: string,
  sport: string,
): Promise<{ sport: CollegeScopeSport; scope: CollegeConferenceScope } | null> {
  if (!isCollegeScopeSport(sport)) return null
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const scope = readCollegeConferenceScope(league?.settings, sport)
  return scope ? { sport, scope } : null
}

/**
 * Each college school's conference, read from `SportsTeam` (Rolling Insights rows, which carry the real
 * conference; the CFBD rows hold only "fbs"/"fcs"). DB-first: nothing here calls a provider.
 *
 * Player rows name their school by its full name ("University of Notre Dame"), which is the team row's
 * `name`; a few name it by code ("ND"), the team row's `shortName`. Both are indexed.
 */
export type CollegeTeamConferences = {
  byName: Map<string, string>
  byCode: Map<string, string>
  /** Every conference the sport has, with how many schools are in it. */
  conferences: Array<{ conference: string; teams: number }>
}

const memo = createTtlMemo<CollegeTeamConferences>({ ttlMs: 60 * 60 * 1000, maxEntries: 4 })

export async function loadCollegeTeamConferences(sport: CollegeScopeSport): Promise<CollegeTeamConferences> {
  const hit = memo.get(sport)
  if (hit) return hit
  const rows = await prisma.sportsTeam.findMany({
    where: { sport, source: 'rolling_insights', conference: { not: null } },
    select: { name: true, shortName: true, conference: true },
  })
  const out = indexCollegeTeamConferences(rows)
  if (out.byName.size > 0) memo.set(sport, out)
  return out
}

export function indexCollegeTeamConferences(
  rows: Array<{ name: string | null; shortName: string | null; conference: string | null }>,
): CollegeTeamConferences {
  const byName = new Map<string, string>()
  const byCode = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const row of rows) {
    const conference = row.conference?.trim()
    if (!conference) continue
    if (row.name?.trim()) byName.set(row.name.trim().toLowerCase(), conference)
    if (row.shortName?.trim()) byCode.set(row.shortName.trim().toUpperCase(), conference)
    counts.set(conference, (counts.get(conference) ?? 0) + 1)
  }
  const conferences = [...counts.entries()]
    .map(([conference, teams]) => ({ conference, teams }))
    .sort((a, b) => b.teams - a.teams || a.conference.localeCompare(b.conference))
  return { byName, byCode, conferences }
}

/** The conference of a player's school, from its full name or its code. */
export function conferenceOfSchool(
  index: CollegeTeamConferences,
  team: string | null | undefined,
  teamCode?: string | null,
): { conference: string | null; name: string | null } {
  const name = team?.trim() || null
  const byName = name ? index.byName.get(name.toLowerCase()) : undefined
  if (byName) return { conference: byName, name }
  const code = (teamCode ?? team)?.trim().toUpperCase()
  return { conference: (code && index.byCode.get(code)) || null, name }
}

/**
 * Keeps the players whose school is in the league's scope. A player whose school cannot be placed is left
 * out (see `collegeSchoolFilter`). ⚠ When the team table is empty the scope cannot be applied at all, so
 * every player is kept and a warning is logged: an empty pool would stop the league's draft dead.
 */
export function filterPoolByCollegeScope<T extends { team?: string | null; team_abbreviation?: string | null }>(
  pool: T[],
  sport: CollegeScopeSport,
  scope: CollegeConferenceScope,
  index: CollegeTeamConferences,
): T[] {
  if (index.byName.size === 0 && index.byCode.size === 0) {
    console.warn('[college-scope] no team conferences stored; conference scope not applied', { sport })
    return pool
  }
  const inScope = collegeSchoolFilter(sport, scope)
  return pool.filter((player) => inScope(conferenceOfSchool(index, player.team, player.team_abbreviation)))
}
