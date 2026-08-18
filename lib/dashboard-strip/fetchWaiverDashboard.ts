import { prisma } from '@/lib/prisma'
import { getTrendingPlayers } from '@/lib/sleeper-client'
import { getLeagueRosters } from '@/lib/api-cache/SleeperCacheLayer'
import type { WaiverDashboardResponse, WaiverDrop, WaiverLeagueRec, WaiverPickup } from '@/app/dashboard/dashboardStripApiTypes'
import { estimateNextWaiversProcessUTC } from '@/lib/time-engine/estimateWaiverRun'

const WAIVER_DASHBOARD_TTL_MS = 15 * 60 * 1000

function buildWaiverDashboardCacheKey(leagueId: string): string {
  return `sleeper:dashboard:waivers:${leagueId}`
}

type SleeperRoster = {
  roster_id?: number
  owner_id?: string
  players?: string[]
  starters?: string[]
}

function sleeperSportFromDb(sport: string): string {
  return sport.toLowerCase()
}

/** Sleeper waiver recommendations + optional injury pulse for dashboard / Today Actions. */
export async function fetchWaiverDashboard(userId: string): Promise<WaiverDashboardResponse> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { sleeperUserId: true },
  })
  const sleeperUserId = profile?.sleeperUserId?.trim() || null

  const sinceInjury = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const leagues = await prisma.league.findMany({
    where: {
      platform: 'sleeper',
      OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: {
      id: true,
      name: true,
      sport: true,
      platform: true,
      platformLeagueId: true,
      avatarUrl: true,
      timezone: true,
      waiverProcessTime: true,
      teams: {
        where: { claimedByUserId: userId },
        select: { platformUserId: true },
        take: 1,
      },
    },
  })

  const recommendations: WaiverLeagueRec[] = []
  const sportsInLeagues = Array.from(new Set(leagues.map((l) => String(l.sport))))

  const injuryPulse =
    sportsInLeagues.length > 0
      ? await prisma.injuryReportRecord
          .findMany({
            where: {
              sport: { in: sportsInLeagues },
              reportDate: { gte: sinceInjury },
            },
            orderBy: { reportDate: 'desc' },
            take: 40,
            select: {
              sport: true,
              playerName: true,
              team: true,
              status: true,
              reportDate: true,
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              sport: r.sport,
              playerName: r.playerName,
              team: r.team,
              status: r.status,
              reportDate: r.reportDate.toISOString(),
            }))
          )
      : []

  for (const league of leagues) {
    if (!league.platformLeagueId) continue

    const ownerSleeperId = league.teams[0]?.platformUserId?.trim() || sleeperUserId || null
    if (!ownerSleeperId) continue

    const cacheKey = buildWaiverDashboardCacheKey(league.platformLeagueId)
    const cachedRow = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
    const staleRecommendation = cachedRow?.data as WaiverLeagueRec | null
    if (cachedRow && cachedRow.expiresAt > new Date() && staleRecommendation) {
      console.log(`[dashboard/waivers] cache hit { leagueId: '${league.platformLeagueId}' }`)
      recommendations.push(staleRecommendation)
      continue
    }

    const prismaSport = String(league.sport)
    const sportKey = sleeperSportFromDb(prismaSport)

    let rec: WaiverLeagueRec = {
      leagueId: league.id,
      leagueName: league.name ?? 'League',
      leagueAvatar: league.avatarUrl ?? null,
      sport: prismaSport,
      platform: 'sleeper',
      pickups: [],
      drops: [],
      chimmyAdvice: 'Waiver data unavailable — check your league directly.',
      waiverDeadline: null,
    }

    try {
      console.log(`[dashboard/waivers] live refresh { leagueId: '${league.platformLeagueId}', reason: '${cachedRow ? 'stale' : 'miss'}' }`)

      const rosters = (await getLeagueRosters(league.platformLeagueId).catch(() => [])) as SleeperRoster[]

      const roster = Array.isArray(rosters)
        ? rosters.find((r) => String(r.owner_id) === String(ownerSleeperId))
        : undefined
      if (!roster?.players?.length) {
        recommendations.push(rec)
        continue
      }

      const starterSet = new Set(
        (roster.starters ?? []).filter((x): x is string => typeof x === 'string' && x.length > 0)
      )
      const rosterIds = roster.players.filter((x): x is string => typeof x === 'string' && x.length > 0)
      const rosterSet = new Set(rosterIds)

      const trending = await getTrendingPlayers(sportKey, 'add', 24, 40)
      const trendingIds = trending.map((t) => t.player_id).filter((id) => !rosterSet.has(id))
      const topPickIds = trendingIds.slice(0, 8)

      if (topPickIds.length === 0) {
        rec.chimmyAdvice = ''
        recommendations.push(rec)
        continue
      }

      const rows = await prisma.sportsPlayer.findMany({
        where: {
          sport: prismaSport,
          externalId: { in: topPickIds.slice(0, 25) },
        },
        select: { externalId: true, name: true, position: true, team: true },
      })
      const byExt = new Map(rows.map((r) => [r.externalId, r]))

      const pickups: WaiverPickup[] = []
      for (const tid of topPickIds.slice(0, 3)) {
        const p = byExt.get(tid)
        const tr = trending.find((x) => x.player_id === tid)
        pickups.push({
          playerId: tid,
          playerName: p?.name ?? `Player ${tid}`,
          position: p?.position ?? '—',
          team: p?.team ?? '—',
          addReason: tr ? `trending add (+${tr.count})` : 'trending add',
        })
      }

      const rosterRows = await prisma.sportsPlayer.findMany({
        where: {
          sport: prismaSport,
          externalId: { in: rosterIds.slice(0, 80) },
        },
        select: { externalId: true, name: true, position: true, team: true },
      })
      const rosterById = new Map(rosterRows.map((r) => [r.externalId, r]))

      const benchIds = rosterIds.filter((id) => !starterSet.has(id))
      const drops: WaiverDrop[] = []
      for (const bid of benchIds.slice(-2)) {
        const p = rosterById.get(bid)
        drops.push({
          playerId: bid,
          playerName: p?.name ?? `Player ${bid}`,
          position: p?.position ?? '—',
          team: p?.team ?? '—',
        })
      }


      const nextWaiver = estimateNextWaiversProcessUTC({
        leagueTimezone: league.timezone,
        waiverProcessTime: league.waiverProcessTime,
      })
      const waiverDeadline = nextWaiver ? nextWaiver.toISOString() : null

      rec = {
        ...rec,
        pickups,
        drops,
        chimmyAdvice: '',
        waiverDeadline,
      }

      await prisma.sportsDataCache.upsert({
        where: { cacheKey },
        create: {
          cacheKey,
          data: rec as unknown as object,
          expiresAt: new Date(Date.now() + WAIVER_DASHBOARD_TTL_MS),
        },
        update: {
          data: rec as unknown as object,
          expiresAt: new Date(Date.now() + WAIVER_DASHBOARD_TTL_MS),
        },
      })
      console.log(`[dashboard/waivers] saved SportsDataCache { leagueId: '${league.platformLeagueId}', cacheKey: '${cacheKey}' }`)
    } catch {
      if (staleRecommendation) {
        console.log(`[dashboard/waivers] stale fallback { leagueId: '${league.platformLeagueId}' }`)
        recommendations.push(staleRecommendation)
        continue
      }
      rec.chimmyAdvice = 'Waiver data unavailable — check your league directly.'
    }

    recommendations.push(rec)
  }

  return {
    totalLeagues: recommendations.length,
    recommendations,
    ...(injuryPulse.length > 0 ? { injuryPulse } : {}),
  }
}
