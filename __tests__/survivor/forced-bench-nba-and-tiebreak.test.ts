// @vitest-environment node
/**
 * Survivor's "forced bench" on the two other Survivor weekly scoring paths:
 *  - NBA Survivor's own scoring (survivorNbaWeeklyScoring.ts, both the one-game and the all-games
 *    mode): the benched starter scores nothing for Survivor that week;
 *  - the key-position tribe tie-break (survivorTribeTieBreak.ts): the benched starter is not a
 *    position leader that week.
 * Both are Survivor's own numbers; the base league's matchup score never reads either. Another week,
 * or another roster, is untouched. Harness from __tests__/survivor-nba-weekly-scoring.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() }, roster: { findFirst: vi.fn() }, redraftSeason: { findFirst: vi.fn() },
  survivorPlayer: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  survivorCommissionerAction: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() }, playerGameStat: { findMany: vi.fn() },
}))
const weekGames = vi.hoisted(() => vi.fn())
const scoring = vi.hoisted(() => ({ calculateScoreFromSportConfig: vi.fn(), isScoringStarterSlot: vi.fn(), scoreRosterForWeek: vi.fn() }))
const rewards = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/redraft/weekGames', () => ({ readWeekGames: weekGames }))
vi.mock('@/lib/redraft/weekLineupSlots', () => ({ loadWeekLineups: vi.fn().mockResolvedValue(new Map()), weekSlotType: vi.fn().mockReturnValue('PG') }))
vi.mock('@/lib/redraft/scoringEngine', () => scoring)
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_id: string, fn: (tx: typeof db) => unknown) => fn(db) }))
vi.mock('@/lib/survivor/survivorRewardEngine', () => ({ listSurvivorRewards: rewards }))

import { scoreNbaSurvivorAllGamesRoster, scoreNbaSurvivorOneGameRoster } from '@/lib/survivor/survivorNbaWeeklyScoring'
import { loadTribePositionLeaderScores } from '@/lib/survivor/survivorTribeTieBreak'

const first = new Date('2026-10-20T23:00:00Z')
const games = [{ startTime: first, homeTeam: 'Boston Celtics', awayTeam: 'New York Knicks', status: 'final', source: 'thesportsdb', fetchedAt: first, season: 2026, week: 1 }]
const bench = (playerId: string, applyWeek = 1, targetRosterId = 'legacy-1') => [{ spec: { type: 'forced_bench', chooserRosterId: 'legacy-9', targetRosterId, playerId }, status: 'applied', applyWeek }]

describe('NBA Survivor scoring with a forced bench', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.league.findUnique.mockResolvedValue({ sport: 'NBA', season: 2026, survivorMode: true, settings: {} })
    db.roster.findFirst.mockResolvedValue({ id: 'legacy-1', redraftRosterId: 'redraft-1', platformUserId: 'user-1' })
    db.redraftRosterPlayer.findMany.mockResolvedValue([
      { playerId: 'pg', playerName: 'PG', position: 'PG', team: 'BOS', sport: 'NBA', slotType: 'PG', addedAt: new Date('2026-10-01T12:00:00Z') },
      { playerId: 'sg', playerName: 'SG', position: 'SG', team: 'BOS', sport: 'NBA', slotType: 'SG', addedAt: new Date('2026-10-01T12:00:00Z') },
    ])
    db.survivorCommissionerAction.findMany.mockResolvedValue([])
    db.playerWeeklyScore.findUnique.mockResolvedValue({ isFinalized: true })
    db.playerGameStat.findMany.mockImplementation(async ({ where }: { where: { playerId: string } }) => [{ normalizedStatMap: { pts: where.playerId === 'pg' ? 24 : 10 }, team: 'BOS', opponent: 'NYK', gameId: 'g1' }])
    weekGames.mockResolvedValue(games)
    scoring.calculateScoreFromSportConfig.mockImplementation(async (_l: string, _p: string, _w: number, stats: { pts: number }) => stats.pts)
    scoring.isScoringStarterSlot.mockReturnValue(true)
    rewards.mockResolvedValue([])
  })

  const score = { leagueId: 'league-1', legacyRosterId: 'legacy-1', week: 1, season: 2026 }

  it('control: without a forced bench both starters count', async () => {
    expect(await scoreNbaSurvivorOneGameRoster(score)).toEqual({ pts: 34, allFinalized: true })
  })

  it('the benched starter scores nothing for Survivor, in both NBA modes', async () => {
    rewards.mockResolvedValue(bench('pg'))
    expect(await scoreNbaSurvivorOneGameRoster(score)).toEqual({ pts: 10, allFinalized: true })
    expect(await scoreNbaSurvivorAllGamesRoster(score)).toEqual({ pts: 10, allFinalized: true })
  })

  it('another week or another roster is untouched', async () => {
    rewards.mockResolvedValue(bench('pg', 2))
    expect(await scoreNbaSurvivorOneGameRoster(score)).toEqual({ pts: 34, allFinalized: true })
    rewards.mockResolvedValue(bench('pg', 1, 'legacy-2'))
    expect(await scoreNbaSurvivorOneGameRoster(score)).toEqual({ pts: 34, allFinalized: true })
  })
})

describe('the key-position tribe tie-break with a forced bench', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.league.findUnique.mockResolvedValue({ sport: 'NFL' })
    db.redraftSeason.findFirst.mockResolvedValue({ season: 2026 })
    db.survivorPlayer.findMany.mockResolvedValue([{ tribeId: 'A', redraftRosterId: 'legacy-1' }, { tribeId: 'B', redraftRosterId: 'legacy-2' }])
    db.roster.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({ redraftRosterId: where.id === 'legacy-1' ? 'rr-1' : 'rr-2' }))
    scoring.scoreRosterForWeek.mockImplementation(async ({ rosterId }: { rosterId: string }) => ({
      points: 0, playerPoints: rosterId === 'rr-1' ? [{ playerId: 'qb-a', points: 30, isStarter: true }] : [{ playerId: 'qb-b', points: 20, isStarter: true }],
    }))
    db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { playerId: { in: string[] } } }) => where.playerId.in.map((playerId) => ({ playerId, position: 'QB' })))
    rewards.mockResolvedValue([])
  })

  it('control: tribe A’s QB leads', async () => {
    expect(await loadTribePositionLeaderScores('L', 5, 'QB', ['A', 'B'])).toEqual(new Map([['A', 30], ['B', 20]]))
  })

  it('a forced-bench QB is not tribe A’s leader that week', async () => {
    rewards.mockResolvedValue(bench('qb-a', 5))
    const leaders = await loadTribePositionLeaderScores('L', 5, 'QB', ['A', 'B'])
    expect(leaders.get('A') ?? 0).toBe(0)
    expect(leaders.get('B')).toBe(20)
  })
})
