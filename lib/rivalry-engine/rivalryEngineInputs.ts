import { prisma } from '@/lib/prisma'

/**
 * The inputs `runRivalryEngine` scores beyond raw head-to-head: trades between a pair, playoff
 * meetings, eliminations, championship meetings, drama events and contention overlap.
 *
 * Moved verbatim from app/api/leagues/[leagueId]/rivalries/handler.ts so the scheduled refresh
 * (lib/relationship-insights/relationshipRefreshPass.ts) builds EXACTLY the input a commissioner
 * pressing "run" does. Two builders of one input would drift; keep this the only one.
 */
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

export interface RivalryEngineSignals {
  tradeCountByPair: Map<string, number>
  playoffMeetingsByPair: Map<string, number>
  eliminationEventsByPair: Map<string, number>
  championshipMeetingsByPair: Map<string, number>
  dramaEventsByPair: Map<string, number>
  contentionOverlapByPair: Map<string, number>
}

export async function buildRivalryEngineSignals(input: {
  leagueId: string
  sport: string
  seasons: number[]
  teamExternalIds: Set<string>
  leagueSettings: unknown
}): Promise<RivalryEngineSignals> {
  const { leagueId, sport, seasons, teamExternalIds, leagueSettings } = input
  const tradeCountByPair = await buildTradeCountByPair(leagueId, seasons, teamExternalIds)
  const { playoffMeetingsByPair, eliminationEventsByPair, championshipMeetingsByPair } =
    await buildMatchupSignalMaps(leagueId, seasons, teamExternalIds, leagueSettings)
  const dramaEventsByPair = await buildDramaEventsByPair(leagueId, sport, seasons, teamExternalIds)
  const contentionOverlapByPair = await buildContentionOverlapByPair(leagueId, seasons, teamExternalIds)
  return {
    tradeCountByPair,
    playoffMeetingsByPair,
    eliminationEventsByPair,
    championshipMeetingsByPair,
    dramaEventsByPair,
    contentionOverlapByPair,
  }
}
