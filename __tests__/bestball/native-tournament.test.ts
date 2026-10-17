import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  season: vi.fn(), contest: vi.fn(), entries: vi.fn(), matches: vi.fn(),
  update: vi.fn(), seasonUpdate: vi.fn(), advance: vi.fn(),
}))
vi.mock('@/lib/prisma', () => {
  const tx = { bestBallEntry: { findMany: m.entries, update: m.update } }
  return { prisma: {
    redraftSeason: { findUniqueOrThrow: m.season, update: m.seasonUpdate },
    bestBallContest: { findUniqueOrThrow: m.contest },
    bestBallEntry: tx.bestBallEntry, redraftMatchup: { findMany: m.matches },
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
  } }
})
vi.mock('@/lib/bestball/finalizeNativeTournamentSeason', () => ({ finalizeNativeTournamentSeason: m.seasonUpdate }))
vi.mock('@/lib/bestball/contestEngine', () => ({ assignEntriesToPods: vi.fn(), advancePodWinners: m.advance }))
import { runNativeTournamentWeek } from '@/lib/bestball/nativeTournament'
import { tournamentRoundEnds, isNativeTournamentLeague } from '@/lib/bestball/tournamentCalendar'
import { resolveCreatedSeasonWeeks } from '@/lib/redraft/createdSeasonLength'
beforeEach(() => {
  vi.clearAllMocks()
  m.season.mockResolvedValue({ league: { bbContestId: 'c', bestBallMode: true, bbTiebreaker: 'max_week', settings: { best_ball_settings: { regularSeasonLength: 2, tournamentAdvancementRounds: 1, contestStructure:'tournament' } } } })
  m.contest.mockResolvedValue({ status: 'active', rounds: 2, scoringPeriod: 'weekly', resetBetweenRounds: true, cumulativeScoring: true })
  m.entries.mockResolvedValue([{ id: 'c:r', currentRound: 1 }])
  m.matches.mockResolvedValue([{ week: 1, status: 'final', homeRosterId: 'r', homeScore: 90 }, { week: 2, status: 'final', homeRosterId: 'r', homeScore: 100 }])
})
describe('Native tournament scheduling', () => {
  it('requires an ordered end week for every round', () => {
    expect(tournamentRoundEnds({ regularSeasonLength: 14, tournamentAdvancementRounds: 3 })).toEqual([14,15,16,17])
    for (const roundEndWeeks of [[2], [2,2], [2,1], [2,NaN]]) expect(() => tournamentRoundEnds({ regularSeasonLength: 2, tournamentAdvancementRounds: 1, roundEndWeeks })).toThrow()
  })
  it('does not take over a standard league with a manually linked contest', () => {
    expect(isNativeTournamentLeague({bbContestId:'c',bestBallMode:true,settings:{best_ball_settings:{contestStructure:'season_long'}}})).toBe(false)
    expect(isNativeTournamentLeague({bbContestId:'c',bestBallMode:false})).toBe(false)
  })
  it('materializes the full custom tournament season', () => {
    expect(resolveCreatedSeasonWeeks({ bbContestId: 'c', bestBallMode:true, settings: { best_ball_settings: { contestStructure:'tournament', regularSeasonLength: 2, tournamentAdvancementRounds: 1, roundEndWeeks: [2,5] } } }, 17)).toBe(5)
  })
  it('does not advance before the round end', async () => {
    expect(await runNativeTournamentWeek('s',1)).toBe('scored')
    expect(m.advance).not.toHaveBeenCalled()
    expect(m.update.mock.calls[0][0].data.totalPoints).toBe(90)
  })
  it('waits for every sealed score instead of inventing zeros', async () => {
    m.matches.mockResolvedValue([{ week: 1, status: 'final', homeRosterId: 'r', homeScore: 90 }])
    expect(await runNativeTournamentWeek('s',2)).toBe('waiting_for_final_scores')
    expect(m.update).not.toHaveBeenCalled()
    expect(m.advance).not.toHaveBeenCalled()
  })
  it('passes the saved tie rule and cumulative native scores to advancement', async () => {
    expect(await runNativeTournamentWeek('s',2)).toBe('advanced')
    expect(m.update.mock.calls[0][0].data.totalPoints).toBe(190)
    expect(m.advance).toHaveBeenCalledWith('c',1,'max_week')
  })
  it('excludes previous rounds when reset is selected', async () => {
    m.entries.mockResolvedValue([{ id: 'c:r', currentRound: 2 }])
    m.matches.mockResolvedValue([{ week: 3, status: 'final', awayRosterId: 'r', awayScore: 80 }])
    expect(await runNativeTournamentWeek('s',3)).toBe('complete')
    expect(m.update.mock.calls[0][0].data.totalPoints).toBe(80)
    expect(m.seasonUpdate).toHaveBeenCalled()
  })
  it('repairs a season completion failure after the contest committed', async () => {
    m.contest.mockResolvedValue({ status: 'complete' })
    expect(await runNativeTournamentWeek('s',4)).toBe('complete')
    expect(m.seasonUpdate).toHaveBeenCalled()
    expect(m.advance).not.toHaveBeenCalled()
  })
  it('refuses concurrent round changes before writing results', async () => {
    m.entries.mockResolvedValueOnce([{ id: 'c:r', currentRound: 1 }]).mockResolvedValueOnce([{ id: 'c:r', currentRound: 2 }])
    await expect(runNativeTournamentWeek('s',2)).rejects.toThrow('round changed')
    expect(m.update).not.toHaveBeenCalled()
  })
})
