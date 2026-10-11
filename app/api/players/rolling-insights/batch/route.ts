import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveCurrentInjuryDesignations } from '@/lib/injuries/currentInjuryDesignations'
import {
  parseRollingInsightsStatsJson,
  type RollingInsightsTableStats,
} from '@/lib/players/rolling-insights-stats-display'

export type RollingInsightsBatchPlayer = {
  season: string | null
  fantasyPointsPerGame: number | null
  fantasyPointsSeason: number | null
  gamesPlayed: number | null
  injuryStatus: string | null
  stats: RollingInsightsTableStats | null
  source: 'rolling_insights'
}

/**
 * Batch lookup: Sleeper player id → latest Rolling Insights season stats (`PlayerIdentityMap` +
 * `PlayerSeasonStats` source `rolling_insights`) + current injury designation (live injury feed).
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    sport?: string
    sleeperIds?: string[]
    season?: string | number | null
  }

  const sport = String(body.sport ?? 'NFL')
    .trim()
    .toUpperCase()
  const sleeperIds = Array.isArray(body.sleeperIds)
    ? body.sleeperIds.map((x) => String(x).trim()).filter(Boolean).slice(0, 100)
    : []

  if (sleeperIds.length === 0) {
    return NextResponse.json({ bySleeperId: {}, meta: { source: 'rolling_insights', empty: true } })
  }

  const seasonFilter =
    body.season != null && body.season !== ''
      ? String(body.season)
      : null

  const maps = await prisma.playerIdentityMap.findMany({
    where: {
      sleeperId: { in: sleeperIds },
      sport,
      rollingInsightsId: { not: null },
    },
    select: {
      sleeperId: true,
      rollingInsightsId: true,
      canonicalName: true,
      currentTeam: true,
      position: true,
    },
  })

  const riIds = [
    ...new Set(
      maps
        .map((m) => m.rollingInsightsId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ]

  if (riIds.length === 0) {
    const empty: Record<string, RollingInsightsBatchPlayer> = {}
    return NextResponse.json({
      bySleeperId: empty,
      meta: { source: 'rolling_insights', mapped: 0 },
    })
  }

  const statsWhere = {
    sport,
    source: 'rolling_insights' as const,
    seasonType: 'regular' as const,
    playerId: { in: riIds },
    ...(seasonFilter ? { season: seasonFilter } : {}),
  }

  const statsRows = await prisma.playerSeasonStats.findMany({
    where: statsWhere,
    orderBy: [{ season: 'desc' }],
    select: {
      playerId: true,
      season: true,
      stats: true,
      fantasyPointsPerGame: true,
      fantasyPoints: true,
      gamesPlayed: true,
    },
  })

  const latestByRi = new Map<
    string,
    {
      season: string
      stats: unknown
      fantasyPointsPerGame: number | null
      fantasyPointsSeason: number | null
      gamesPlayed: number | null
    }
  >()

  for (const row of statsRows) {
    if (!latestByRi.has(row.playerId)) {
      latestByRi.set(row.playerId, {
        season: row.season,
        stats: row.stats,
        fantasyPointsPerGame: row.fantasyPointsPerGame ?? null,
        fantasyPointsSeason: row.fantasyPoints ?? null,
        gamesPlayed: row.gamesPlayed ?? null,
      })
    }
  }

  /*
   * 🛑 `injuryStatus` IS A LIVE INJURY DESIGNATION OR NULL — NEVER A ROSTER CODE. This used to return
   * `PlayerIdentityMap.status || SportsPlayer.status`, which for Rolling Insights is "ACT" / "INACT",
   * and the league Players tab drew an amber "Injury status: ACT" dot on healthy players. The read
   * port reads live `SportsInjury` rows only, newest claim wins, namesakes refused.
   */
  const designations = await resolveCurrentInjuryDesignations({
    sport,
    players: maps
      .filter((m) => typeof m.canonicalName === 'string' && m.canonicalName.trim())
      .map((m) => ({ key: m, name: m.canonicalName, team: m.currentTeam, position: m.position })),
  }).catch(() => new Map<(typeof maps)[number], { status: string }>())

  const bySleeperId: Record<string, RollingInsightsBatchPlayer> = {}

  for (const m of maps) {
    const sid = m.sleeperId
    const ri = m.rollingInsightsId
    if (!sid || !ri) continue

    const latest = latestByRi.get(ri)
    const rawStats = latest?.stats
    const parsed = parseRollingInsightsStatsJson(rawStats)

    const injuryStatus = designations.get(m)?.status ?? null

    bySleeperId[sid] = {
      season: latest?.season ?? null,
      fantasyPointsPerGame: latest?.fantasyPointsPerGame ?? null,
      fantasyPointsSeason: latest?.fantasyPointsSeason ?? null,
      gamesPlayed: latest?.gamesPlayed ?? null,
      injuryStatus,
      stats: parsed,
      source: 'rolling_insights',
    }
  }

  return NextResponse.json({
    bySleeperId,
    meta: {
      source: 'rolling_insights',
      sport,
      mapped: Object.keys(bySleeperId).length,
    },
  })
}
