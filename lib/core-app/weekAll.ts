import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Your week, across every league — read from WeeklyMatchup.
 *
 * ⚠ THE JOIN IS `League.platformLeagueId`, NOT `League.id`. WeeklyMatchup is
 * written by lib/rankings-engine/sleeper-matchup-cache.ts from Sleeper's payload,
 * so its `leagueId` holds the PLATFORM league id ("1313536441829068800"), and its
 * `rosterId` holds Sleeper's numeric roster_id. Measured on production:
 *
 *     WeeklyMatchup.leagueId matching League.id               → 0
 *     WeeklyMatchup.leagueId matching League.platformLeagueId → 2
 *
 * Joining on `id` — the obvious choice, and the one every other loader here uses —
 * returns an empty set with no error. This repo has two league-id spaces and this
 * table lives in the other one.
 *
 * ⚠ WHAT IS ACTUALLY ON FILE (production, read-only count):
 *     262 rows, ALL season 2025, weeks up to 17, across 6 distinct platform
 *     leagues — of which only 2 still exist in `League`.
 * So this is real history, not a live current week. The season is carried on the
 * result and must be shown: labelling 2025 results as "your week" would be the
 * lie. Nothing here is projected or simulated.
 */

export type WeekRow = {
  leagueId: string
  leagueName: string
  platform: string | null
  season: number
  week: number
  pointsFor: number
  pointsAgainst: number
  won: boolean
}

export type WeekAllData = {
  rows: WeekRow[]
  /** The season these rows come from — never assume it is the current one. */
  season: number | null
  week: number | null
  /** Leagues the user has that carry no matchup history at all. */
  withoutHistory: number
  /**
   * Matchups that EXIST for this week but have not been played. Distinct from
   * `withoutHistory`: those leagues have no schedule at all, these have one that
   * has not started. Before a season opens this is the whole list, and saying so
   * is the difference between "no results yet" and an empty screen.
   */
  unscored: number
  record: { wins: number; losses: number } | null
}

export async function getWeekAll(
  userId: string,
  leagues: Array<{ id: string; name?: string | null; platform?: string | null; platformLeagueId?: string | null }>,
): Promise<WeekAllData> {
  const empty: WeekAllData = {
    rows: [],
    season: null,
    week: null,
    withoutHistory: leagues.length,
    unscored: 0,
    record: null,
  }

  const platformIds = leagues
    .map((l) => l.platformLeagueId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  if (platformIds.length === 0) return empty

  /*
   * Latest season/week actually present, rather than "now". The clock is 2026 and
   * every row is 2025 — asking for the current week returns nothing and reads as
   * a bug rather than as an empty season.
   */
  const latest = await prisma.weeklyMatchup.findFirst({
    where: { leagueId: { in: platformIds } },
    orderBy: [{ seasonYear: 'desc' }, { week: 'desc' }],
    select: { seasonYear: true, week: true },
  })
  if (!latest) return empty

  const [matchups, myTeams] = await Promise.all([
    prisma.weeklyMatchup.findMany({
      where: { leagueId: { in: platformIds }, seasonYear: latest.seasonYear, week: latest.week },
      select: { leagueId: true, rosterId: true, pointsFor: true, pointsAgainst: true, win: true },
    }),
    prisma.leagueTeam.findMany({
      where: { league: { platformLeagueId: { in: platformIds } }, claimedByUserId: userId },
      select: { externalId: true, league: { select: { id: true, name: true, platform: true, platformLeagueId: true } } },
    }),
  ])

  // Sleeper roster ids are numeric on WeeklyMatchup and strings on LeagueTeam.
  const mine = new Map<string, { leagueId: string; name: string; platform: string | null }>()
  for (const team of myTeams) {
    const platformLeagueId = team.league?.platformLeagueId
    const roster = Number(team.externalId)
    if (!platformLeagueId || !Number.isFinite(roster)) continue
    mine.set(`${platformLeagueId}:${roster}`, {
      leagueId: team.league!.id,
      name: team.league?.name?.trim() || 'League',
      platform: team.league?.platform ?? null,
    })
  }

  const rows: WeekRow[] = []

  let unscored = 0
  for (const m of matchups) {
    const meta = mine.get(`${m.leagueId}:${m.rosterId}`)
    if (!meta) continue // not the user's team in that league

    /*
     * ⚠ AN UNSCORED MATCHUP IS NOT A PLAYED ONE, AND IT WAS BEING COUNTED AS A
     * LOSS. WeeklyMatchup holds a row as soon as the schedule exists, with
     * pointsFor/pointsAgainst at 0 and `win` unset. Those rows were pushed
     * unconditionally, so the dashboard rendered "L  0.00 — 0.00  +0.00" for a
     * game nobody has played — and because `won` is `win === 1`, every one of
     * them landed in the LOSS column. That is where "0-2 in week 2" came from on
     * an account whose season has not started: two fabricated defeats.
     *
     * A real fantasy matchup that finished 0-0 does not occur; a scheduled one
     * that has not started always looks exactly like this. Skipping them is the
     * difference between "no results yet" and "you lost".
     */
    const scored = m.pointsFor > 0 || m.pointsAgainst > 0
    if (!scored) {
      unscored += 1
      continue
    }

    rows.push({
      leagueId: meta.leagueId,
      leagueName: meta.name,
      platform: meta.platform,
      season: latest.seasonYear,
      week: latest.week,
      pointsFor: m.pointsFor,
      pointsAgainst: m.pointsAgainst,
      won: m.win === 1,
    })
  }

  rows.sort((a, b) => b.pointsFor - a.pointsFor)

  /*
   * Surfaced rather than swallowed. "Nothing to show" and "12 matchups exist but
   * none have been played" are different states, and the second one is the
   * common case before a season opens — the reader should be told which they are
   * looking at.
   */

  const record = rows.length
    ? { wins: rows.filter((r) => r.won).length, losses: rows.filter((r) => !r.won).length }
    : null

  return {
    rows,
    season: latest.seasonYear,
    week: latest.week,
    withoutHistory: Math.max(0, leagues.length - rows.length),
    unscored,
    record,
  }
}
