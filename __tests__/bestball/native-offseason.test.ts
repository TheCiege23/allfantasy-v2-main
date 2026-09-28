import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ season: vi.fn(), contest: vi.fn(), update: vi.fn(), transition: vi.fn(), archive: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: async (fn: any) => fn({ redraftSeason: { findUniqueOrThrow: m.season, update: m.update }, bestBallContest: { findUniqueOrThrow: m.contest } }) } }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ transitionLeagueStateInTransaction: m.transition }))
vi.mock('@/lib/redraft/offseason/RedraftOffseasonService', () => ({ enterRedraftOffseason: m.archive }))
import { finalizeNativeTournamentSeason } from '@/lib/bestball/finalizeNativeTournamentSeason'
beforeEach(() => {
  vi.clearAllMocks()
  m.season.mockResolvedValue({ leagueId: 'league', league: { lifecycleState: 'post_draft', bbContestId: 'contest', bestBallMode: true, settings: { best_ball_settings: { contestStructure: 'tournament' } } } })
  m.contest.mockResolvedValue({ id: 'contest', status: 'complete' })
  m.archive.mockResolvedValue({ ok: true, snapshotId: 'archive' })
})
describe('Tournament offseason handoff', () => {
  it('follows legal phases after a completed draft and archives', async () => {
    await finalizeNativeTournamentSeason('season')
    expect(m.transition.mock.calls.map(c => c[1].nextState)).toEqual(['in_season', 'completed'])
    expect(m.update).toHaveBeenCalledWith({ where: { id: 'season' }, data: { status: 'complete' } })
    expect(m.archive).toHaveBeenCalledWith('season', 'system:native-tournament')
  })
  it('retries archival after season completion without another lifecycle transition', async () => {
    const season = await m.season()
    season.league.lifecycleState = 'completed'
    await finalizeNativeTournamentSeason('season')
    expect(m.transition).not.toHaveBeenCalled()
    expect(m.archive).toHaveBeenCalledTimes(1)
  })
  it('surfaces an archival refusal for the cron retry', async () => {
    m.archive.mockResolvedValue({ ok: false, code: 'TOURNAMENT_RESULT_INCOMPLETE' })
    await expect(finalizeNativeTournamentSeason('season')).rejects.toThrow('TOURNAMENT_RESULT_INCOMPLETE')
  })
  it.each(['setup', 'pre_draft', 'drafting', 'archived'])('refuses completion from %s', async state => {
    const season = await m.season()
    season.league.lifecycleState = state
    await expect(finalizeNativeTournamentSeason('season')).rejects.toThrow('invalid league phase')
    expect(m.update).not.toHaveBeenCalled()
    expect(m.archive).not.toHaveBeenCalled()
  })
  it('refuses an unfinished contest', async () => {
    m.contest.mockResolvedValue({ status: 'active' })
    await expect(finalizeNativeTournamentSeason('season')).rejects.toThrow('not complete')
    expect(m.update).not.toHaveBeenCalled()
  })
})
