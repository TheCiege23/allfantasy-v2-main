import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { loadPlayerPools } from '@/lib/league/player-pools/load'
import { countTeamsByPlayerPool, type PlayerPools } from '@/lib/league/player-pools/policy'
import { getWarmDraftPoolSnapshotFast } from './ensureDraftPoolReady'
import { CURRENT_DRAFT_SESSION_ORDER } from './currentDraftSession'

type League = { sport: string; leagueType: string | null; platform: string; settings: unknown }
type Draft = { rounds: number; teamCount: number; draftModeLabel: string | null; slotOrder: unknown }

export type NflDraftPoolCapacity = {
  eligiblePlayers: number
  requiredPlayers: number
  rosterFeedRefreshedAt: string | null
  error: string | null
}

export function requiredDraftPoolPlayers(
  rosterIds: readonly string[],
  pools: PlayerPools,
  rounds: number,
): number {
  return Math.max(0, ...countTeamsByPlayerPool(rosterIds, pools).values()) * rounds
}

export async function getNflDraftPoolCapacity(
  leagueId: string,
  known?: { league: League; session: Draft },
  includeFreshness = false,
): Promise<NflDraftPoolCapacity | null> {
  const league = known?.league ?? await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, leagueType: true, platform: true, settings: true },
  })
  if (!league || league.sport !== 'NFL' || !['redraft', 'dynasty'].includes(league.leagueType ?? '') ||
    resolveWriteAuthority(league.platform) !== 'NATIVE') return null

  const session = known?.session ?? await prisma.draftSession.findFirst({
    where: { leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { rounds: true, teamCount: true, draftModeLabel: true, slotOrder: true, status: true },
  })
  if (!session || session.draftModeLabel === 'rookie' || ('status' in session && session.status !== 'pre_draft')) return null

  const [readiness, pools, freshness] = await Promise.all([
    getWarmDraftPoolSnapshotFast(leagueId),
    loadPlayerPools(leagueId, { settings: league.settings }),
    includeFreshness ? prisma.sportsPlayer.aggregate({
      where: { sport: 'NFL', source: 'sleeper', team: { not: null } },
      _max: { fetchedAt: true },
    }) : null,
  ])
  const rosterIds: string[] = Array.isArray(session.slotOrder)
    ? session.slotOrder.map(entry => entry?.rosterId).filter((id): id is string => typeof id === 'string')
    : []
  let requiredPlayers = session.teamCount * session.rounds
  let error: string | null = null
  if (pools) {
    const seats = new Set(rosterIds)
    if (seats.size !== session.teamCount || [...seats].some(id => !pools[id])) {
      error = 'Assign every draft seat to a player pool in commissioner division settings.'
    } else {
      requiredPlayers = requiredDraftPoolPlayers(rosterIds, pools, session.rounds)
    }
  }
  const eligibleIds = new Set<string>()
  if (readiness.warm) {
    for (const entry of readiness.payload.entries ?? []) {
      const id = (entry as { playerId?: unknown } | null)?.playerId
      if (typeof id === 'string' && id) eligibleIds.add(id)
    }
  }
  const eligiblePlayers = eligibleIds.size
  if (!error && !readiness.warm) error = 'The player pool is still loading. Try again when the player pool is ready.'
  if (!error && eligiblePlayers < requiredPlayers) {
    error = 'The largest pool needs ' + requiredPlayers + ' different players and has ' + eligiblePlayers
      + ' eligible players. Check the roster feed, reduce draft rounds, or use smaller player pools.'
  }
  return { eligiblePlayers, requiredPlayers, error, rosterFeedRefreshedAt: freshness?._max.fetchedAt?.toISOString() ?? null }
}
