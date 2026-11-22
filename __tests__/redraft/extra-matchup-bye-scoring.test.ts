import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The leftover team's bye row is scored when the extra matchup is on, even with league median off —
 * the extra game is decided on that score. Week 1, which no advance opens, gets its pick here.
 */

const { db, assignExtraMatchupForWeek } = vi.hoisted(() => ({
  db: {
    league: { findFirst: vi.fn() },
    redraftMatchup: { findFirst: vi.fn(), update: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn() },
    playerWeeklyScore: { findUnique: vi.fn() },
    roster: { findMany: vi.fn() },
    afRosterLineupAssignment: { findMany: vi.fn() },
  },
  assignExtraMatchupForWeek: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/redraft/oddTeamExtraMatchup', () => ({ assignExtraMatchupForWeek }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({ leagueUsesDevyEngine: vi.fn(async () => false), calculateOfficialTeamScore: vi.fn() }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { updateMatchupScores } from '@/lib/redraft/scoringEngine'

const RECORD = { opponentRosterId: 'opp', rule: 'top_scorer', reason: 'seeded_draw', scoring: 'leftover_only', basisWeek: null, decidedAt: 'x' }

beforeEach(() => {
  vi.clearAllMocks()
  db.redraftMatchup.update.mockResolvedValue({})
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL', medianGame: false })
  db.roster.findMany.mockResolvedValue([])
  db.afRosterLineupAssignment.findMany.mockResolvedValue([])
  db.redraftRosterPlayer.findMany.mockResolvedValue([
    { playerId: 'w1', position: 'WR', slotType: 'WR', rosterId: 'leftover', sport: 'NFL', playerName: 'w1', droppedAt: null },
  ])
  db.playerWeeklyScore.findUnique.mockResolvedValue({ stats: { rec_yds: 100 }, isFinalized: true })
  db.redraftMatchup.findFirst.mockResolvedValue({
    id: 'bye-row', leagueId: 'L1', seasonId: 's1', week: 1, homeRosterId: 'leftover', awayRosterId: null,
    homeRoster: {}, homeScore: 0, awayScore: 0, lineupSnapshots: null,
  })
  assignExtraMatchupForWeek.mockResolvedValue({ status: 'assigned', record: RECORD, matchupId: 'bye-row' })
})

describe('scoring the leftover team for its extra game', () => {
  it('week 1: fixes the pick, then scores the bye row and keeps the pick on it', async () => {
    db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: { odd_team_extra_matchup: { enabled: true } }, medianGame: false })
    await updateMatchupScores('bye-row')
    expect(assignExtraMatchupForWeek).toHaveBeenCalledWith({ seasonId: 's1', week: 1 })
    const data = db.redraftMatchup.update.mock.calls[0]![0].data
    expect(data.homeScore).toBeGreaterThan(0)
    expect(data.status).toBe('final')
    expect(data.lineupSnapshots.extraMatchup).toEqual(RECORD)
  })

  it('a pick fixed at week open is scored without asking again', async () => {
    db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: { odd_team_extra_matchup: { enabled: true } }, medianGame: false })
    db.redraftMatchup.findFirst.mockResolvedValue({
      id: 'bye-row', leagueId: 'L1', seasonId: 's1', week: 4, homeRosterId: 'leftover', awayRosterId: null,
      homeRoster: {}, homeScore: 0, awayScore: 0, lineupSnapshots: { extraMatchup: RECORD },
    })
    await updateMatchupScores('bye-row')
    expect(assignExtraMatchupForWeek).not.toHaveBeenCalled()
    expect(db.redraftMatchup.update.mock.calls[0]![0].data.lineupSnapshots.extraMatchup).toEqual(RECORD)
  })

  it('off, and no median: the bye row stays unscored', async () => {
    db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: {}, medianGame: false })
    await updateMatchupScores('bye-row')
    expect(assignExtraMatchupForWeek).not.toHaveBeenCalled()
    expect(db.redraftMatchup.update).not.toHaveBeenCalled()
  })
})
