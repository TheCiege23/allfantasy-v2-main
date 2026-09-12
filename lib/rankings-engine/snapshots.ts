import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"

export interface SnapshotMetrics {
  starterValuePercentile: number
  expectedWins: number
  injuryHealthRatio: number
  tradeEffPremium: number
  winScore?: number
  powerScore?: number
  luckScore?: number
  marketValueScore?: number
  managerSkillScore?: number
  futureCapitalScore?: number
  draftGainP?: number
  benchPercentile?: number
  riskConcentration?: number
}

export async function saveRankingsSnapshot(args: {
  leagueId: string
  season: string
  week: number
  teams: Array<{
    rosterId: string | number
    rank: number
    composite: number
    expectedWins?: number | null
    luckDelta?: number | null
    metricsJson?: SnapshotMetrics | null
  }>
}) {
  const { leagueId, season, week } = args
  const league = await prisma.league.findFirst({
    where: { OR: [{ id: leagueId }, { platformLeagueId: leagueId }] },
    select: { sport: true },
  })
  const sportType = league?.sport ?? null

  /*
   * 🛑 STAMPED EXPLICITLY, ON BOTH BRANCHES, BECAUSE `createdAt` IS READ AS "WHEN DID WE LAST
   * WRITE ONE" AND THE UPSERT'S UPDATE BRANCH WOULD OTHERWISE NEVER MOVE IT.
   *
   * `RankingsSnapshot` carries `createdAt @default(now())` and no `@updatedAt`. `@default` only
   * applies on INSERT, so re-snapshotting a league for a (season, week) it already has left the
   * column pinned to the first write, forever. Nothing failed and no row was wrong — the rows were
   * freshly recomputed — but every consumer of the column asks the opposite question:
   *
   *   - `rankingsSweep` due-ness   `orderBy: { createdAt: 'desc' }` against an 18h TTL
   *   - `api-health-monitor`       `orderBy: [{ createdAt: 'desc' }]`, a provider freshness probe
   *
   * A frozen value therefore made every already-snapshotted league PERMANENTLY due once 18h had
   * passed — the TTL stopped suppressing re-work and the sweep spent its per-fire budget on
   * leagues it had just refreshed — and made the health probe report a stale age for data written
   * minutes earlier. Censused before changing the meaning: `backtest.ts` (x3), `getRankHistory`,
   * `getLeagueSparklines` and `SeasonForecastEngine` order and filter by `rank`/`week`/`season`
   * only, so NO reader wants "first created" and both readers that touch it are fixed by this.
   *
   * ⚠ ONE INSTANT FOR THE WHOLE SNAPSHOT, captured before the map rather than per row. A per-row
   * `new Date()` scatters one logical write across milliseconds, which makes `max(createdAt)`
   * answer a subtly different question per roster.
   */
  const writtenAt = new Date()

  await prisma.$transaction(
    args.teams.map((t) =>
      prisma.rankingsSnapshot.upsert({
        where: {
          uniq_snapshot_league_season_week_roster: {
            leagueId,
            season,
            week,
            rosterId: String(t.rosterId)
          }
        },
        update: {
          createdAt: writtenAt,
          sportType,
          rank: Number(t.rank),
          composite: t.composite,
          expectedWins: t.expectedWins ?? null,
          luckDelta: t.luckDelta ?? null,
          metricsJson: t.metricsJson ? (t.metricsJson as unknown as Prisma.InputJsonValue) : undefined,
        },
        create: {
          createdAt: writtenAt,
          leagueId,
          sportType,
          season,
          week,
          rosterId: String(t.rosterId),
          rank: Number(t.rank),
          composite: t.composite,
          expectedWins: t.expectedWins ?? null,
          luckDelta: t.luckDelta ?? null,
          metricsJson: t.metricsJson ? (t.metricsJson as unknown as Prisma.InputJsonValue) : undefined,
        }
      })
    )
  )
}

export async function getPreviousWeekSnapshots(args: {
  leagueId: string
  season: string
  currentWeek: number
}): Promise<Map<string, { rank: number; composite: number; metrics: SnapshotMetrics | null }>> {
  const prevWeek = args.currentWeek - 1
  if (prevWeek < 1) return new Map()

  const rows = await prisma.rankingsSnapshot.findMany({
    where: {
      leagueId: args.leagueId,
      season: args.season,
      week: prevWeek,
    },
  })

  const map = new Map<string, { rank: number; composite: number; metrics: SnapshotMetrics | null }>()
  for (const r of rows) {
    const metrics = r.metricsJson as SnapshotMetrics | null
    map.set(r.rosterId, {
      rank: r.rank,
      composite: Number(r.composite),
      metrics,
    })
  }
  return map
}

export async function getRankHistory(args: {
  leagueId: string
  rosterId: string
  limit?: number
}) {
  const rows = await prisma.rankingsSnapshot.findMany({
    where: { leagueId: args.leagueId, rosterId: args.rosterId },
    orderBy: [{ season: "desc" }, { week: "desc" }],
    take: args.limit ?? 12
  })

  return rows.reverse()
}

export async function getLeagueSparklines(args: {
  leagueId: string
  season: string
  maxWeeks?: number
}): Promise<Map<string, number[]>> {
  const rows = await prisma.rankingsSnapshot.findMany({
    where: { leagueId: args.leagueId, season: args.season },
    orderBy: [{ week: 'asc' }],
    select: { rosterId: true, week: true, rank: true },
  })

  const map = new Map<string, number[]>()
  const weekSet = new Set<number>()
  for (const r of rows) weekSet.add(r.week)
  const weeks = Array.from(weekSet).sort((a, b) => a - b)
  const limit = args.maxWeeks ?? 12
  const recentWeeks = weeks.slice(-limit)

  const recentWeekSet = new Set(recentWeeks)
  for (const r of rows) {
    if (!recentWeekSet.has(r.week)) continue
    if (!map.has(r.rosterId)) map.set(r.rosterId, [])
    map.get(r.rosterId)!.push(r.rank)
  }

  return map
}
