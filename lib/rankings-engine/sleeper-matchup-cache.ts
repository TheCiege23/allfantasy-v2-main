import { prisma } from '@/lib/prisma'
import { getLeagueMatchups } from '@/lib/sleeper-client'

/*
 * ⚠ NO DEFAULT SEASON, ON PURPOSE. This module shipped with
 * `const CURRENT_SEASON = 2025` as the default for every function — once the
 * 2026 season started, any caller that omitted the season would fetch CURRENT
 * Sleeper matchups and write them under seasonYear 2025, poisoning the table
 * while every reader looked at the (frozen) 2026 rows. The season is now a
 * required parameter; callers thread it from the league.
 */

interface CachedWeekStat {
  week: number
  rosterId: number
  pointsFor: number
  pointsAgainst: number
  win: number
  matchupId: number | null
}

const STALE_THRESHOLD_MS = 30 * 60 * 1000

export async function ensureMatchupsCached(
  leagueId: string,
  maxWeek: number,
  seasonYear: number,
): Promise<void> {
  const existing = await prisma.weeklyMatchup.groupBy({
    by: ['week'],
    where: { leagueId, seasonYear },
    _max: { updatedAt: true },
    _sum: { pointsFor: true },
  })

  const cachedWeeks = new Map<number, { updatedAt: Date; totalPoints: number }>()
  for (const r of existing) {
    cachedWeeks.set(r.week, {
      updatedAt: r._max.updatedAt ?? new Date(0),
      totalPoints: r._sum.pointsFor ?? 0,
    })
  }

  /*
   * ⚠ THE STALENESS REFRESH MUST FOLLOW THE SEASON, NOT THE ARGUMENT. This
   * used to refresh only `maxWeek` — and callers pass maxWeek=18, so once the
   * full schedule was cached as 0-0 rows, weeks 1–17 were "cached" forever and
   * every WeeklyMatchup-backed surface reported unplayed games all season.
   *
   * The frontier is the earliest cached week with zero total points — the week
   * currently being played (or next to play). When stale we refresh the
   * frontier, the week before it (the most recent scoring week: still in
   * progress on a Sunday night, and receiving stat corrections after), and
   * maxWeek as before. That is at most three Sleeper fetches per staleness
   * window instead of refetching the whole season.
   */
  let frontierWeek: number | null = null
  for (let w = 1; w <= maxWeek; w++) {
    const c = cachedWeeks.get(w)
    if (c && c.totalPoints === 0) {
      frontierWeek = w
      break
    }
  }
  const refreshWeeks = new Set<number>([maxWeek])
  if (frontierWeek !== null) {
    refreshWeeks.add(frontierWeek)
    if (frontierWeek > 1) refreshWeeks.add(frontierWeek - 1)
  }

  const now = Date.now()
  const missingWeeks: number[] = []
  for (let w = 1; w <= maxWeek; w++) {
    const cached = cachedWeeks.get(w)
    if (!cached) {
      missingWeeks.push(w)
    } else if (refreshWeeks.has(w) && now - cached.updatedAt.getTime() > STALE_THRESHOLD_MS) {
      await prisma.weeklyMatchup.deleteMany({ where: { leagueId, seasonYear, week: w } })
      missingWeeks.push(w)
    }
  }

  if (missingWeeks.length === 0) return

  const fetchPromises = missingWeeks.map(w =>
    getLeagueMatchups(leagueId, w).then(matchups => ({ week: w, matchups })),
  )
  const results = await Promise.all(fetchPromises)

  for (const { week, matchups } of results) {
    const matchupMap = new Map<number, typeof matchups>()
    for (const m of matchups) {
      if (!m.matchup_id) continue
      const group = matchupMap.get(m.matchup_id) || []
      group.push(m)
      matchupMap.set(m.matchup_id, group)
    }

    const rows = matchups.map(m => {
      let oppPoints = 0
      if (m.matchup_id) {
        const group = matchupMap.get(m.matchup_id) || []
        const opp = group.find(x => x.roster_id !== m.roster_id)
        oppPoints = opp?.points || 0
      }
      const pts = m.points || 0
      return {
        leagueId,
        seasonYear,
        week,
        rosterId: m.roster_id,
        matchupId: m.matchup_id || null,
        pointsFor: pts,
        pointsAgainst: oppPoints,
        win: pts > oppPoints ? 1 : 0,
      }
    })

    if (rows.length > 0) {
      await prisma.weeklyMatchup.createMany({
        data: rows,
        skipDuplicates: true,
      })
    }
  }
}

export async function getWeekStatsFromCache(
  leagueId: string,
  maxWeek: number,
  seasonYear: number,
): Promise<{
  weekStats: CachedWeekStat[]
  weeklyPointsByRoster: Map<number, number[]>
  weeklyOpponentPointsByRoster: Map<number, number[]>
}> {
  await ensureMatchupsCached(leagueId, maxWeek, seasonYear)

  const rows = await prisma.weeklyMatchup.findMany({
    where: { leagueId, seasonYear, week: { lte: maxWeek } },
    orderBy: [{ week: 'asc' }, { rosterId: 'asc' }],
  })

  const weekStats: CachedWeekStat[] = []
  const weeklyPointsByRoster = new Map<number, number[]>()
  const weeklyOpponentPointsByRoster = new Map<number, number[]>()

  for (const r of rows) {
    weekStats.push({
      week: r.week,
      rosterId: r.rosterId,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      win: r.win,
      matchupId: r.matchupId,
    })

    const pts = weeklyPointsByRoster.get(r.rosterId) || []
    while (pts.length < r.week - 1) pts.push(0)
    pts.push(r.pointsFor)
    weeklyPointsByRoster.set(r.rosterId, pts)

    const opp = weeklyOpponentPointsByRoster.get(r.rosterId) || []
    while (opp.length < r.week - 1) opp.push(0)
    opp.push(r.matchupId !== null ? r.pointsAgainst : 0)
    weeklyOpponentPointsByRoster.set(r.rosterId, opp)
  }

  return { weekStats, weeklyPointsByRoster, weeklyOpponentPointsByRoster }
}

export async function refreshWeekCache(
  leagueId: string,
  week: number,
  seasonYear: number,
): Promise<void> {
  await prisma.weeklyMatchup.deleteMany({
    where: { leagueId, seasonYear, week },
  })
  await ensureMatchupsCached(leagueId, week, seasonYear)
}
