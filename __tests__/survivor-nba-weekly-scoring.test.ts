// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() }, roster: { findFirst: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  survivorCommissionerAction: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() }, playerGameStat: { findMany: vi.fn() },
}))
const weekGames = vi.hoisted(() => vi.fn())
const scoring = vi.hoisted(() => ({ calculateScoreFromSportConfig: vi.fn(), isScoringStarterSlot: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/redraft/weekGames', () => ({ readWeekGames: weekGames }))
vi.mock('@/lib/redraft/weekLineupSlots', () => ({ loadWeekLineups: vi.fn().mockResolvedValue(new Map()), weekSlotType: vi.fn().mockReturnValue('PG') }))
vi.mock('@/lib/redraft/scoringEngine', () => scoring)
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_id: string, fn: (tx: typeof db) => unknown) => fn(db) }))

import { getNbaSurvivorGameOptions, saveNbaSurvivorGamePick, scoreNbaSurvivorOneGameRoster } from '@/lib/survivor/survivorNbaWeeklyScoring'

const first = new Date('2026-10-20T23:00:00Z')
const second = new Date('2026-10-23T23:00:00Z')
const games = [
  { startTime: first, homeTeam: 'Boston Celtics', awayTeam: 'New York Knicks', status: 'final', source: 'thesportsdb', fetchedAt: first, season: 2026, week: 1 },
  { startTime: second, homeTeam: 'Boston Celtics', awayTeam: 'Miami Heat', status: 'final', source: 'thesportsdb', fetchedAt: second, season: 2026, week: 1 },
]

describe('NBA Survivor one-game scoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.league.findUnique.mockResolvedValue({ sport: 'NBA', season: 2026, survivorMode: true, settings: { nbaWeeklyScoringMode: 'one_game_per_player' } })
    db.roster.findFirst.mockResolvedValue({ id: 'legacy-1', redraftRosterId: 'redraft-1', platformUserId: 'user-1' })
    db.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'player-1', playerName: 'Sample PG', position: 'PG', team: 'BOS', sport: 'NBA', slotType: 'PG', addedAt: new Date('2026-10-01T12:00:00Z') }])
    db.survivorCommissionerAction.findMany.mockResolvedValue([])
    db.survivorCommissionerAction.findUnique.mockResolvedValue(null)
    db.survivorCommissionerAction.upsert.mockResolvedValue({})
    db.playerWeeklyScore.findUnique.mockResolvedValue({ isFinalized: true })
    db.playerGameStat.findMany.mockResolvedValue([{ normalizedStatMap: { pts: 24 }, team: 'BOS', opponent: 'NYK', gameId: 'game-1' }])
    weekGames.mockResolvedValue(games)
    scoring.calculateScoreFromSportConfig.mockImplementation(async (_leagueId, _playerId, _week, stats: { pts: number }) => stats.pts)
    scoring.isScoringStarterSlot.mockReturnValue(true)
  })

  it('shows the first game as the automatic choice and refuses a late switch', async () => {
    const options = await getNbaSurvivorGameOptions({ leagueId: 'league-1', rosterId: 'legacy-1', week: 1, now: new Date('2026-10-19T12:00:00Z') })
    expect(options.ok).toBe(true)
    if (!options.ok) return
    expect(options.players[0].countingGameKey).toBe(options.players[0].games[0].gameKey)
    expect(options.players[0].selectedGameKey).toBeNull()
    expect(await saveNbaSurvivorGamePick({ leagueId: 'league-1', rosterId: 'legacy-1', userId: 'user-1', week: 1, playerId: 'player-1', gameKey: options.players[0].games[1].gameKey, now: new Date('2026-10-21T12:00:00Z') })).toEqual({ ok: false, error: 'This player’s counting game has started; the weekly choice is locked.' })
    expect(db.survivorCommissionerAction.upsert).not.toHaveBeenCalled()
  })

  it('scores the selected game rather than adding the player’s whole week', async () => {
    db.survivorCommissionerAction.findMany.mockResolvedValue([{ newState: { playerId: 'player-1', gameKey: `${second.toISOString()}:BOS:MIA`, startAt: second.toISOString() } }])
    db.playerGameStat.findMany.mockResolvedValue([{ normalizedStatMap: { pts: 18 }, team: 'BOS', opponent: 'MIA', gameId: 'game-2' }])
    const result = await scoreNbaSurvivorOneGameRoster({ leagueId: 'league-1', legacyRosterId: 'legacy-1', week: 1, season: 2026 })
    expect(result).toEqual({ pts: 18, allFinalized: true })
    expect(db.playerGameStat.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ gameDate: new Date('2026-10-23T00:00:00Z') }) }))
  })

  it('does not score an earlier game for a player acquired midweek', async () => {
    db.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'player-1', playerName: 'Sample PG', position: 'PG', team: 'BOS', sport: 'NBA', slotType: 'PG', addedAt: new Date('2026-10-22T12:00:00Z') }])
    const options = await getNbaSurvivorGameOptions({ leagueId: 'league-1', rosterId: 'legacy-1', week: 1, now: new Date('2026-10-22T13:00:00Z') })
    expect(options.ok).toBe(true)
    if (options.ok) expect(options.players[0].games.map(game => game.startAt)).toEqual([second.toISOString()])
  })
})
