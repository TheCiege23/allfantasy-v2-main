import { prisma } from '@/lib/prisma'
import { createTtlMemo } from '@/lib/ttl-memo'
import { collegeSchoolFilter, type CollegeConferenceScope, type CollegeScopeSport } from '@/lib/college/conferenceScope'

/**
 * The conference of each school a devy / C2C college player is listed under (`DevyPlayer.school`).
 *
 * `DevyPlayer.conference` is empty in production (2026-11-25), and its school names are not the team
 * table's: football rows say "Alabama" (CFBD), basketball rows "Abilene Christian Wildcats" (ESPN). So:
 *
 * - FOOTBALL: the CFBD team row's code ("ALA") → the Rolling Insights team with that code, which carries
 *   the conference. Code first, because name guessing is wrong where it matters: "Miami" by name is Miami
 *   University (MAC), by code (MIA) the University of Miami (ACC). When CFBD's code differs from Rolling
 *   Insights' ("BOIS" vs "BSU"), the name is tried: "University of X", "X University", then "X".
 *   Measured: all 51 devy schools placed, and code-first got every one right.
 * - BASKETBALL: the school's players, through `PlayerIdentityMap.espnId` → their Rolling Insights row →
 *   its school's conference, decided by majority (a transfer's row can still name his old school).
 *   Measured: all 361 schools placed. Matching by name prefix instead was rejected: it sent "Florida
 *   International" to Florida and "Missouri State" to Missouri.
 *
 * DB-first; nothing here calls a provider.
 */

export type RiTeamRow = { name: string | null; shortName: string | null; conference: string | null }
export type CfbdTeamRow = { name: string | null; shortName: string | null }

export function indexNcaafDevySchools(cfbd: CfbdTeamRow[], ri: RiTeamRow[]): (school: string) => string | null {
  const byCode = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const r of ri) {
    if (!r.conference) continue
    if (r.shortName) byCode.set(r.shortName.trim().toUpperCase(), r.conference)
    if (r.name) byName.set(r.name.trim().toLowerCase(), r.conference)
  }
  const cfbdCode = new Map<string, string>()
  for (const c of cfbd) if (c.name && c.shortName) cfbdCode.set(c.name.trim().toLowerCase(), c.shortName.trim().toUpperCase())
  return (school: string) => {
    const s = school.trim()
    if (!s) return null
    const code = cfbdCode.get(s.toLowerCase())
    const viaCode = code ? byCode.get(code) : undefined
    if (viaCode) return viaCode
    for (const candidate of [`University of ${s}`, `${s} University`, s]) {
      const hit = byName.get(candidate.toLowerCase())
      if (hit) return hit
    }
    return null
  }
}

/** Majority conference per school from (school, conference, players) votes. */
export function majorityConference(votes: Array<{ school: string; conference: string; n: number }>): Map<string, string> {
  const best = new Map<string, { conference: string; n: number }>()
  for (const v of votes) {
    const cur = best.get(v.school)
    if (!cur || v.n > cur.n) best.set(v.school, { conference: v.conference, n: v.n })
  }
  return new Map([...best].map(([school, { conference }]) => [school, conference]))
}

const memo = createTtlMemo<Map<string, string>>({ ttlMs: 60 * 60 * 1000, maxEntries: 4 })

/** Devy school name → conference, for every school with eligible devy players. */
export async function loadDevySchoolConferences(sport: CollegeScopeSport): Promise<Map<string, string>> {
  const hit = memo.get(sport)
  if (hit) return hit
  let out: Map<string, string>
  if (sport === 'NCAAF') {
    const [schools, cfbd, ri] = await Promise.all([
      prisma.devyPlayer.findMany({ where: { sport, devyEligible: true, graduatedToNFL: false }, select: { school: true }, distinct: ['school'] }),
      prisma.sportsTeam.findMany({ where: { sport, source: 'cfbd' }, select: { name: true, shortName: true } }),
      prisma.sportsTeam.findMany({ where: { sport, source: 'rolling_insights', conference: { not: null } }, select: { name: true, shortName: true, conference: true } }),
    ])
    const conferenceOf = indexNcaafDevySchools(cfbd, ri)
    out = new Map()
    for (const { school } of schools) {
      const conference = school ? conferenceOf(school) : null
      if (school && conference) out.set(school, conference)
    }
  } else {
    const votes = await prisma.$queryRaw<Array<{ school: string; conference: string; n: number }>>`
      SELECT d.school AS school, st.conference AS conference, count(*)::int AS n
      FROM "DevyPlayer" d
      JOIN "PlayerIdentityMap" pim ON pim.sport = 'NCAAB' AND pim."espnId" = substring(d.id from 'espn:ncaab:([0-9]+)')
      JOIN "SportsPlayer" sp ON sp.sport = 'NCAAB' AND sp.source = 'rolling_insights' AND sp."externalId" = pim."rollingInsightsId"
      JOIN "SportsTeam" st ON st.sport = 'NCAAB' AND st.source = 'rolling_insights' AND lower(st.name) = lower(sp.team)
      WHERE d.sport = 'NCAAB' AND d."devyEligible" = true AND d."graduatedToNFL" = false AND st.conference IS NOT NULL
      GROUP BY d.school, st.conference`
    out = majorityConference(votes)
  }
  if (out.size > 0) memo.set(sport, out)
  return out
}

/**
 * The devy school names a scope admits, for a `school: { in: [...] }` read, so the pool's take limit is
 * filled from in-scope players. Null when the schools cannot be placed at all: the scope is then not
 * applied (logged), because an empty college pool would stop the league's draft.
 */
export function devySchoolsInScope(sport: CollegeScopeSport, scope: CollegeConferenceScope, schools: Map<string, string>): string[] | null {
  if (schools.size === 0) {
    console.warn('[college-scope] no devy school conferences; conference scope not applied', { sport })
    return null
  }
  const inScope = collegeSchoolFilter(sport, scope)
  // Named schools (Notre Dame, UConn) are matched by full name; devy rows use short names, so admit them
  // by their conference here and let the full-name rule cover the rest.
  return [...schools]
    .filter(([school, conference]) => inScope({ conference, name: school }) || inScope({ conference, name: `University of ${school}` }))
    .map(([school]) => school)
}
