/**
 * College football bye weeks for the draft pool (2026-11-20). The BYE column was blank for every
 * college player: rosters name schools formally ("University of Mississippi", Rolling Insights)
 * while the schedule uses short names ("Ole Miss", CFBD), and no crosswalk existed. One does now —
 * `cfbdScheduleTeamKeys` in lib/sports-data/collegeTeamNames.ts, which the lineup lock already uses —
 * so both sides go through it here.
 *
 * Reads CFBD's stored schedule (`SportsGame`, source cfbd); no provider is called. A school's bye is
 * a week that HAS games (other schools play) inside the school's own first-to-last game span, in
 * which the school does not play. Both limits matter, measured on the 2026 schedule:
 *   - Week 14 has no stored games at all (championship week is not loaded) and week 15 is only
 *     Army–Navy, so "a gap in the school's weeks" alone would hand every team a week-14 bye.
 *   - Weeks before a school's first game and after its last are not byes.
 * Checked: Alabama 9, Georgia 8, Ohio State 8, Ole Miss 5, Texas Tech 6, Navy 3 and 11.
 *
 * Many schools have two byes; the pool shows the NEXT one still to come, or the first when every
 * bye has passed. A school the crosswalk cannot place gets null (a dash), never a guess.
 *
 * ⚠ Names: the exact key always identifies one school; the loose key ("vanderbilt university" ->
 * "vanderbilt") is used only where no two schools share it over the whole season ("Illinois" and
 * D-III "Illinois College" are both "illinois" loosely) — the lineup lock's rule.
 */
import { cfbdScheduleTeamKeys } from '@/lib/sports-data/collegeTeamNames'

export interface CollegeScheduleRow {
  week: number | null
  homeTeam: string
  awayTeam: string
  startTime: Date | string | null
}

export interface CollegeByeIndex {
  byExact: Map<string, number[]>
  byLoose: Map<string, number[]>
  /** When each week's last game starts — a bye is "past" once its week is over. */
  weekEnds: Map<number, number>
}

/** Pure: every school's bye weeks from one season's regular-season schedule. */
export function buildCollegeByeIndex(rows: readonly CollegeScheduleRow[]): CollegeByeIndex {
  const weeksByExact = new Map<string, Set<number>>()
  const exactsByLoose = new Map<string, Set<string>>()
  const looseOfExact = new Map<string, string>()
  const weekEnds = new Map<number, number>()

  for (const row of rows) {
    if (row.week == null || !Number.isInteger(row.week)) continue
    const t = row.startTime ? new Date(row.startTime).getTime() : NaN
    if (Number.isFinite(t)) weekEnds.set(row.week, Math.max(weekEnds.get(row.week) ?? 0, t))
    else if (!weekEnds.has(row.week)) weekEnds.set(row.week, 0)
    for (const team of [row.homeTeam, row.awayTeam]) {
      const { exact, loose } = cfbdScheduleTeamKeys(team)
      if (!exact) continue
      const weeks = weeksByExact.get(exact) ?? new Set<number>()
      weeks.add(row.week)
      weeksByExact.set(exact, weeks)
      if (loose) {
        exactsByLoose.set(loose, (exactsByLoose.get(loose) ?? new Set()).add(exact))
        looseOfExact.set(exact, loose)
      }
    }
  }

  const activeWeeks = [...weekEnds.keys()].sort((a, b) => a - b)
  const byExact = new Map<string, number[]>()
  const byLoose = new Map<string, number[]>()
  for (const [exact, weeks] of weeksByExact) {
    const played = [...weeks].sort((a, b) => a - b)
    const first = played[0]!
    const last = played[played.length - 1]!
    const byes = activeWeeks.filter((w) => w > first && w < last && !weeks.has(w))
    byExact.set(exact, byes)
    const loose = looseOfExact.get(exact)
    if (loose && exactsByLoose.get(loose)?.size === 1) byLoose.set(loose, byes)
  }
  return { byExact, byLoose, weekEnds }
}

/** The school's bye weeks, or null when the crosswalk cannot place it. */
export function collegeByeWeeksFor(index: CollegeByeIndex, team: string | null | undefined): number[] | null {
  const { exact, loose } = cfbdScheduleTeamKeys(team)
  if (exact && index.byExact.has(exact)) return index.byExact.get(exact)!
  if (loose && index.byLoose.has(loose)) return index.byLoose.get(loose)!
  return null
}

/** The bye to show: the next one still to come, else the first. Null when none is known. */
export function collegeByeWeekFor(
  index: CollegeByeIndex,
  team: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const byes = collegeByeWeeksFor(index, team)
  if (!byes || byes.length === 0) return null
  const upcoming = byes.find((w) => (index.weekEnds.get(w) ?? 0) + 24 * 60 * 60 * 1000 > now.getTime())
  return upcoming ?? byes[0]!
}

/**
 * Pure: set `byeWeek` on the college rows of a pool (`isCollege` decides which); pro rows are left
 * alone. A college row's existing bye is REPLACED, not kept: a bye an NFL lookup gave a school
 * ("Tennessee" read as the Titans) is wrong, and an unplaced school gets null rather than keep it.
 */
export function attachCollegeByeWeeks<T>(
  entries: T[],
  index: CollegeByeIndex,
  isCollege: (row: Record<string, unknown>) => boolean,
  now: Date = new Date(),
): T[] {
  if (index.byExact.size === 0) return entries
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const row = entry as Record<string, unknown>
    if (!isCollege(row)) return entry
    const school = typeof row.school === 'string' && row.school ? row.school : typeof row.team === 'string' ? row.team : null
    const week = collegeByeWeekFor(index, school, now)
    return row.byeWeek === week ? entry : ({ ...row, byeWeek: week } as T)
  })
}

/** Server: one season's index from CFBD's stored schedule. Empty when nothing is stored. */
export async function loadCollegeByeIndex(season: number | null | undefined): Promise<CollegeByeIndex> {
  const empty: CollegeByeIndex = { byExact: new Map(), byLoose: new Map(), weekEnds: new Map() }
  if (season == null || !Number.isInteger(season)) return empty
  const { prisma } = await import('@/lib/prisma')
  const rows = await prisma.sportsGame.findMany({
    where: {
      sport: { equals: 'NCAAF', mode: 'insensitive' },
      source: 'cfbd',
      season,
      week: { not: null },
      NOT: { seasonType: { in: ['post', 'postseason'] } },
    },
    select: { week: true, homeTeam: true, awayTeam: true, startTime: true },
  })
  return buildCollegeByeIndex(rows)
}
