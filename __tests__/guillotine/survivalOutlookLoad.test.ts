/**
 * The survival outlook loader joins a team's starters to their clubs' games and projections. These pin the
 * join for an IMPORTED league (provider team → stored roster → starters) and for a native one (redraft roster
 * → league roster), with the slate and the player board as stored — nothing calls a provider.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  games: [] as Array<Record<string, unknown>>,
  board: null as null | { season: number; unit: string; rows: Array<{ rosterPlayerId: string; team: string | null; weekly: number | null }> },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ sport: 'NBA', season: 2026 })) },
    leagueTeam: { findMany: vi.fn(async () => [{ externalId: '1', platformUserId: 'u1' }, { externalId: '2', platformUserId: 'u2' }]) },
    roster: {
      findMany: vi.fn(async (q: { select: Record<string, boolean> }) =>
        q.select.redraftRosterId
          ? [{ id: 'R1', platformUserId: 'u1', redraftRosterId: 'rr1' }, { id: 'R2', platformUserId: 'u2', redraftRosterId: 'rr2' }]
          : [{ id: 'R1', platformUserId: 'u1', playerData: { starters: ['p1', 'p2', '0'] } }, { id: 'R2', platformUserId: 'u2', playerData: { starters: ['p3'] } }]),
    },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 'S', season: 2026 })) },
    redraftRoster: { findMany: vi.fn(async () => [{ id: 'rr1', ownerId: 'o1' }, { id: 'rr2', ownerId: 'o2' }]) },
    redraftRosterPlayer: {
      findMany: vi.fn(async () => [
        { rosterId: 'rr1', playerId: 'p1', team: 'BOS', slotType: 'starter', position: 'PG' },
        { rosterId: 'rr1', playerId: 'p2', team: 'LAL', slotType: 'bench', position: 'C' },
        { rosterId: 'rr2', playerId: 'p3', team: 'LAL', slotType: 'starter', position: 'SF' },
      ]),
    },
  },
}))
vi.mock('@/lib/redraft/weekGames', () => ({ readWeekGames: vi.fn(async () => h.games) }))
vi.mock('@/lib/redraft/weekLineupSlots', () => ({ loadWeekLineups: vi.fn(async () => new Map()), weekSlotType: (p: { slotType: string }) => p.slotType }))
vi.mock('@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime', () => ({ isNflRedraftScoringStarterSlot: (s: string) => s === 'starter' }))
vi.mock('@/lib/season-week/dailySportSeasonStarts', () => ({ resolveDailySportWeekWindow: () => ({ start: new Date(0), end: new Date(1) }) }))
vi.mock('@/lib/af-projections/leagueProjectionSchedule', () => ({ projectionTeamKey: (_s: string, t: string | null) => (t ? t.toUpperCase() : null) }))
vi.mock('@/lib/af-projections/leaguePlayerMetrics', () => ({ loadLeaguePlayerMetrics: vi.fn(async () => h.board) }))

import { loadImportedSurvivalOutlook, loadSurvivalOutlook } from '@/lib/guillotine/survivalOutlookLoad'

const game = (home: string, away: string, status: string) => ({ homeTeam: home, awayTeam: away, status, startTime: new Date(), source: 'x', fetchedAt: new Date(), season: 2026, week: 6 })

beforeEach(() => {
  // BOS: 3 games, 1 played. LAL: 2 games, both left.
  h.games = [game('BOS', 'NYK', 'final'), game('BOS', 'MIA', 'scheduled'), game('LAL', 'BOS', 'scheduled'), game('LAL', 'PHX', 'scheduled')]
  h.board = { season: 2026, unit: 'fantasy points', rows: [
    { rosterPlayerId: 'p1', team: 'BOS', weekly: 60 },
    { rosterPlayerId: 'p2', team: 'LAL', weekly: 40 },
    { rosterPlayerId: 'p3', team: 'LAL', weekly: 30 },
  ] }
})

describe('imported', () => {
  it('🛑 joins provider team → stored roster → starters, and prorates each projection to the games left', async () => {
    const o = await loadImportedSurvivalOutlook('L', 6, ['1', '2'])
    // Team 1: p1 (BOS, 2 of 3 left → 40) and p2 (LAL, 2 of 2 → 40); the empty '0' slot is not a player.
    expect(o?.['1']).toEqual({ playersLeft: 2, starters: 2, gamesLeft: 4, remainingProjection: 80, partial: false })
    expect(o?.['2']).toEqual({ playersLeft: 1, starters: 1, gamesLeft: 2, remainingProjection: 30, partial: false })
  })
  it('a slate it cannot read gives no outlook, never "no games left"', async () => {
    h.games = []
    expect(await loadImportedSurvivalOutlook('L', 6, ['1', '2'])).toBeNull()
  })
  it('a board for another season projects nothing, so the remainder is unknown rather than 0', async () => {
    h.board = { ...h.board!, season: 2025 }
    expect((await loadImportedSurvivalOutlook('L', 6, ['1', '2']))?.['1']?.remainingProjection).toBeNull()
  })
  it('no week, no teams: no outlook', async () => {
    expect(await loadImportedSurvivalOutlook('L', null, ['1'])).toBeNull()
    expect(await loadImportedSurvivalOutlook('L', 6, [])).toBeNull()
  })
})

describe('native', () => {
  it('keys by league roster id and counts only this week\'s starters', async () => {
    const o = await loadSurvivalOutlook('L', 6)
    expect(Object.keys(o ?? {}).sort()).toEqual(['R1', 'R2'])
    // p2 is on R1's bench, so only p1 counts.
    expect(o?.R1).toEqual({ playersLeft: 1, starters: 1, gamesLeft: 2, remainingProjection: 40, partial: false })
  })

  it('🛑 a two-week league covers both weeks of the period, with the lineup of the week being played', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { readWeekGames } = await import('@/lib/redraft/weekGames')
    const { loadWeekLineups } = await import('@/lib/redraft/weekLineupSlots')
    vi.mocked(prisma.league.findUnique).mockResolvedValueOnce({ sport: 'NBA', season: 2026, settings: { guillotine_period_weeks: 2 } } as never)
    vi.mocked(prisma.redraftSeason.findFirst).mockResolvedValueOnce({ id: 'S', season: 2026, currentWeek: 5 } as never)
    vi.mocked(readWeekGames).mockClear()
    const o = await loadSurvivalOutlook('L', 6)
    // Both slates read; the lineup is week 5's, the one being played.
    expect(vi.mocked(readWeekGames).mock.calls.map((c) => (c[1] as { week: number }).week)).toEqual([5, 6])
    expect(vi.mocked(loadWeekLineups).mock.calls.at(-1)?.[1]).toMatchObject({ week: 5 })
    // p1 (BOS): 3 games a week, 2 left in each read → 4 of 6; projected 60 a week → 120 × 4/6 = 80.
    expect(o?.R1).toEqual({ playersLeft: 1, starters: 1, gamesLeft: 4, remainingProjection: 80, partial: false })
  })
})
