import { NextResponse } from 'next/server'
import { listRivalries } from '@/lib/rivalry-engine/RivalryQueryService'
import { runRivalryEngine } from '@/lib/rivalry-engine/RivalryEngine'
import { normalizeSportForRivalry } from '@/lib/rivalry-engine/SportRivalryResolver'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

function pairKey(managerAId: string, managerBId: string): string {
  return managerAId <= managerBId ? `${managerAId}|${managerBId}` : `${managerBId}|${managerAId}`
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean)
    } catch {
      return []
    }
  }
  return []
}

function resolvePlayoffStartWeek(
  leagueSettings: unknown,
  seasonMaxWeek: number
): number {
  const settings = (leagueSettings ?? {}) as Record<string, unknown>
  const candidates = [
    settings.playoff_week_start,
    settings.playoffStartWeek,
    settings.playoff_start_week,
    settings.playoffStart,
    (settings.schedule as Record<string, unknown> | undefined)?.playoffStartWeek,
  ]
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c
    if (typeof c === 'string') {
      const parsed = parseInt(c, 10)
      if (!Number.isNaN(parsed) && parsed > 0) return parsed
    }
  }
  return Math.max(1, seasonMaxWeek - 2)
}

async function buildTradeCountByPair(
  leagueId: string,
  seasons: number[],
  teamExternalIds: Set<string>
): Promise<Map<string, number>> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, platformLeagueId: true },
  })
  if (!league || league.platform !== 'sleeper') return new Map()
  const dynastySeasons = await prisma.leagueDynastySeason.findMany({
    where: { leagueId },
    select: { platformLeagueId: true },
  })
  const platformIds =
    dynastySeasons.length > 0
      ? dynastySeasons.map((d) => d.platformLeagueId)
      : league.platformLeagueId
        ? [league.platformLeagueId]
        : []
  if (platformIds.length === 0) return new Map()
  const histories = await prisma.leagueTradeHistory.findMany({
    where: { sleeperLeagueId: { in: platformIds } },
    include: { trades: true },
  })
  const counts = new Map<string, number>()
  const txToRosters = new Map<string, Set<string>>()
  for (const h of histories) {
    for (const t of h.trades) {
      if (!seasons.includes(t.season)) continue
      if (t.partnerRosterId == null) continue
      const partner = String(t.partnerRosterId)
      if (!teamExternalIds.has(partner)) continue
      const set = txToRosters.get(t.transactionId) ?? new Set<string>()
      set.add(partner)
      txToRosters.set(t.transactionId, set)
    }
  }
  for (const [, rosters] of txToRosters) {
    const ids = [...rosters]
    if (ids.length < 2) continue
    const key = pairKey(ids[0]!, ids[1]!)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

async function buildMatchupSignalMaps(
  leagueId: string,
  seasons: number[],
  teamExternalIds: Set<string>,
  leagueSettings: unknown
): Promise<{
  playoffMeetingsByPair: Map<string, number>
  eliminationEventsByPair: Map<string, number>
  championshipMeetingsByPair: Map<string, number>
}> {
  const facts = await prisma.matchupFact.findMany({
    where: { leagueId, season: { in: seasons } },
    orderBy: [{ season: 'asc' }, { weekOrPeriod: 'asc' }],
  })
  const champions = await prisma.seasonResult.findMany({
    where: { leagueId, season: { in: seasons.map(String) }, champion: true },
    select: { season: true, rosterId: true },
  })
  const championBySeason = new Map<number, string>()
  for (const c of champions) {
    const season = parseInt(c.season, 10)
    if (!Number.isNaN(season)) championBySeason.set(season, c.rosterId)
  }
  const maxWeekBySeason = new Map<number, number>()
  for (const f of facts) {
    if (f.season == null) continue
    maxWeekBySeason.set(f.season, Math.max(maxWeekBySeason.get(f.season) ?? 0, f.weekOrPeriod))
  }

  const playoffMeetingsByPair = new Map<string, number>()
  const eliminationEventsByPair = new Map<string, number>()
  const championshipMeetingsByPair = new Map<string, number>()
  const factsBySeason = new Map<number, typeof facts>()
  for (const f of facts) {
    if (f.season == null) continue
    const arr = factsBySeason.get(f.season) ?? []
    arr.push(f)
    factsBySeason.set(f.season, arr)
  }

  for (const [season, seasonFacts] of factsBySeason) {
    const playoffStartWeek = resolvePlayoffStartWeek(leagueSettings, maxWeekBySeason.get(season) ?? 0)
    const championshipWeek = maxWeekBySeason.get(season) ?? playoffStartWeek
    const championRoster = championBySeason.get(season) ?? null

    for (const f of seasonFacts) {
      const teamA = String(f.teamA)
      const teamB = String(f.teamB)
      if (!teamExternalIds.has(teamA) || !teamExternalIds.has(teamB)) continue
      if (f.weekOrPeriod < playoffStartWeek) continue
      const key = pairKey(teamA, teamB)
      playoffMeetingsByPair.set(key, (playoffMeetingsByPair.get(key) ?? 0) + 1)

      if (f.winnerTeamId) {
        const winner = String(f.winnerTeamId)
        const loser = winner === teamA ? teamB : winner === teamB ? teamA : null
        if (loser != null) {
          eliminationEventsByPair.set(key, (eliminationEventsByPair.get(key) ?? 0) + 1)
        }
      }

      if (f.weekOrPeriod === championshipWeek && championRoster && (teamA === championRoster || teamB === championRoster)) {
        championshipMeetingsByPair.set(key, (championshipMeetingsByPair.get(key) ?? 0) + 1)
      }
    }
  }

  return { playoffMeetingsByPair, eliminationEventsByPair, championshipMeetingsByPair }
}

async function buildDramaEventsByPair(
  leagueId: string,
  sport: string,
  seasons: number[],
  teamExternalIds: Set<string>
): Promise<Map<string, number>> {
  const events = await prisma.dramaEvent.findMany({
    where: {
      leagueId,
      sport,
      season: { in: seasons },
    },
    select: { relatedTeamIds: true },
  })
  const byPair = new Map<string, number>()
  for (const event of events) {
    const ids = toStringArray(event.relatedTeamIds).filter((id) => teamExternalIds.has(id))
    if (ids.length < 2) continue
    for (let i = 0; i < ids.length - 1; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = pairKey(ids[i]!, ids[j]!)
        byPair.set(key, (byPair.get(key) ?? 0) + 1)
      }
    }
  }
  return byPair
}

async function buildContentionOverlapByPair(
  leagueId: string,
  seasons: number[],
  teamExternalIds: Set<string>
): Promise<Map<string, number>> {
  const results = await prisma.seasonResult.findMany({
    where: { leagueId, season: { in: seasons.map(String) } },
    select: { season: true, rosterId: true, wins: true },
  })
  const bySeason = new Map<number, Array<{ rosterId: string; wins: number }>>()
  for (const row of results) {
    const season = parseInt(row.season, 10)
    if (Number.isNaN(season)) continue
    if (!teamExternalIds.has(row.rosterId)) continue
    const arr = bySeason.get(season) ?? []
    arr.push({ rosterId: row.rosterId, wins: row.wins ?? 0 })
    bySeason.set(season, arr)
  }
  const overlapCounts = new Map<string, number>()
  for (const [, rows] of bySeason) {
    if (rows.length < 2) continue
    rows.sort((a, b) => b.wins - a.wins)
    const contenders = rows.slice(0, Math.max(2, Math.ceil(rows.length / 2))).map((r) => r.rosterId)
    for (let i = 0; i < contenders.length - 1; i++) {
      for (let j = i + 1; j < contenders.length; j++) {
        const key = pairKey(contenders[i]!, contenders[j]!)
        overlapCounts.set(key, (overlapCounts.get(key) ?? 0) + 1)
      }
    }
  }
  const overlapScore = new Map<string, number>()
  for (const [key, count] of overlapCounts) {
    overlapScore.set(key, Math.min(100, count * 25))
  }
  return overlapScore
}

/**
 * GET /api/leagues/[leagueId]/rivalries
 * List rivalries for the league.
 * Query: sport, season, managerId, managerAId, managerBId, limit.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    // Membership gate. Reachable both directly and via the [section]
    // dispatcher, and was open to anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response

    const url = new URL(req.url)
    const sportRaw = url.searchParams?.get('sport')
    const sport = sportRaw ? (normalizeSportForRivalry(sportRaw) ?? undefined) : undefined
    const seasonParam = url.searchParams?.get('season')
    const season = seasonParam != null ? parseInt(seasonParam, 10) : undefined
    const managerId = url.searchParams?.get('managerId') ?? undefined
    const managerAId = url.searchParams?.get('managerAId') ?? undefined
    const managerBId = url.searchParams?.get('managerBId') ?? undefined
    const limitParam = url.searchParams?.get('limit')
    const limit = limitParam != null ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50

    const rivalries = await listRivalries(leagueId, {
      sport,
      season: Number.isNaN(season ?? NaN) ? undefined : season,
      managerId,
      managerAId,
      managerBId,
      limit,
    })
    return NextResponse.json({ leagueId, rivalries })
  } catch (e) {
    console.error('[rivalries GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list rivalries' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/leagues/[leagueId]/rivalries
 * Run the rivalry engine for the league (detect, score, persist).
 * Body: { sport?, seasons? }.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    // Membership gate. Reachable both directly and via the [section]
    // dispatcher, and was open to anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { sport: true, season: true, settings: true, teams: { select: { externalId: true } } },
    })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    let body: { sport?: string; seasons?: number[] } = {}
    try {
      body = await req.json()
    } catch {
      // optional body
    }
    const sport = normalizeToSupportedSport(body.sport ?? league.sport ?? null)
    const seasons = Array.isArray(body.seasons) && body.seasons.length > 0
      ? body.seasons
      : [league.season ?? new Date().getFullYear()].filter(Boolean)

    const teamExternalIds = new Set(league.teams.map((t) => String(t.externalId)))
    const tradeCountByManagerPair = await buildTradeCountByPair(leagueId, seasons, teamExternalIds)
    const { playoffMeetingsByPair, eliminationEventsByPair, championshipMeetingsByPair } =
      await buildMatchupSignalMaps(leagueId, seasons, teamExternalIds, league.settings)
    const dramaEventsByPair = await buildDramaEventsByPair(leagueId, sport, seasons, teamExternalIds)
    const contentionOverlapByPair = await buildContentionOverlapByPair(leagueId, seasons, teamExternalIds)

    const result = await runRivalryEngine({
      leagueId,
      sport,
      seasons,
      tradeCountByPair: tradeCountByManagerPair,
      playoffMeetingsByPair,
      eliminationEventsByPair,
      championshipMeetingsByPair,
      dramaEventsByPair,
      contentionOverlapByPair,
    })

    return NextResponse.json({ leagueId, ...result })
  } catch (e) {
    console.error('[rivalries POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to run rivalry engine' },
      { status: 500 }
    )
  }
}
