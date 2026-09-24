/**
 * In best ball the bench scores too — the matchup starts each team's best lineup — so the live
 * tick has to fetch stats for the whole eligible roster, not only the starter slots. A lineup
 * league keeps fetching starters only (the Sleeper budget depends on it).
 */
import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import type { LiveStatsProvider } from '@/lib/live-scoring/provider'
import { runLiveScoringTickForSeason } from '@/server/services/liveScoring/liveScoreRunner'

const SEASON = { id: 's-nfl', leagueId: 'l-nfl', sport: 'NFL', season: 2026, currentWeek: 3 }
const ROSTER = [
  { playerId: 'qb1', slotType: 'QB' },
  { playerId: 'bench1', slotType: 'BENCH' },
  { playerId: 'ir1', slotType: 'IR' },
  { playerId: 'taxi1', slotType: 'TAXI' },
]

function fakePrisma(league: Record<string, unknown> | null) {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async () => {
          if (name === 'league' && method === 'findFirst') return league
          if (name === 'redraftRosterPlayer' && method === 'findMany') return ROSTER
          if (method.startsWith('find') && method !== 'findMany') return null
          if (method === 'count') return 0
          return []
        },
      },
    )
  return new Proxy({}, { get: (_t, prop: string) => model(prop) }) as unknown as PrismaClient
}

function provider() {
  return {
    fetchActiveGames: vi.fn(async () => [
      { gameId: 'g1', status: 'in_progress', startTime: new Date('2026-09-27T17:00:00Z'), homeTeam: 'KC', awayTeam: 'BUF' },
    ]),
    fetchPlayerStatsForGames: vi.fn(async () => new Map()),
    fetchTeamDefenseStatsForGames: vi.fn(async () => new Map()),
    normalizeGameStatus: vi.fn(() => 'in_progress' as const),
  }
}

async function fetchedIds(league: Record<string, unknown> | null): Promise<string[]> {
  const p = provider()
  await runLiveScoringTickForSeason(fakePrisma(league), SEASON, {
    provider: p as unknown as LiveStatsProvider,
    broadcast: () => {},
    seasonType: 'regular',
    now: new Date('2026-09-27T18:00:00Z'),
  })
  expect(p.fetchPlayerStatsForGames).toHaveBeenCalledTimes(1)
  const args = p.fetchPlayerStatsForGames.mock.calls[0]![0] as { playerIds: string[] }
  return [...args.playerIds].sort()
}

describe('live tick — best ball fetches the whole eligible roster', () => {
  it('best ball: starters and bench, never IR or taxi', async () => {
    expect(await fetchedIds({ bestBallMode: true, leagueType: 'best_ball', leagueVariant: null })).toEqual(['bench1', 'qb1'])
  })

  it('lineup league: starters only', async () => {
    expect(await fetchedIds({ bestBallMode: false, leagueType: 'redraft', leagueVariant: null })).toEqual(['qb1'])
  })

  it('an unreadable league narrows the tick to starters rather than failing it', async () => {
    expect(await fetchedIds(null)).toEqual(['qb1'])
  })
})
