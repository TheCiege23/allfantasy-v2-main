import { beforeEach, expect, it, vi } from 'vitest'
import { completeConfig } from './helpers/seasonTournamentFixture'
const source = vi.hoisted(() => ({ contract: vi.fn(), schedule: vi.fn(), live: vi.fn(), pairs: vi.fn(), candidates: vi.fn() }))
vi.mock('@/lib/tournament/seasonScheduleReview', () => ({ loadPublishedScheduleContract: source.contract }))
vi.mock('@/lib/tournament/seasonCalendarVerification', async original => {
  const actual = await original<typeof import('@/lib/tournament/seasonCalendarVerification')>()
  return { ...actual, fetchSeasonCalendarGames: source.schedule }
})
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: source.live }))
vi.mock('@/lib/tournament/seasonScoreLedger', () => ({ readSeasonOpeningLockedProviderPairs: source.pairs }))
vi.mock('@/lib/tournament/seasonOutcomeEvidenceStore', () => ({ readSeasonOutcomeCandidates: source.candidates }))
import { reviewSeasonPeriodLiveFeed } from '@/lib/tournament/seasonPeriodLiveReview'
beforeEach(() => {
  vi.resetAllMocks()
  const config = completeConfig()
  source.contract.mockResolvedValue({ manifest: { config }, calendar: { assignments: [{ gameId: 'g1', startsAt: '2026-10-12T00:00:00Z', period: 1 }] } })
  source.schedule.mockResolvedValue({ games: [{ gameId: 'g1', startTime: '2026-10-12T00:00:00Z', seasonType: 'regular', status: 'scheduled', replacedBy: null }] })
  source.live.mockResolvedValue({ rows: [{ game_ID: 'g1', status: 'final', season_type: 'Regular Season' }], error: null, notModified: false, unsupported: false })
  source.candidates.mockResolvedValue({ revision: 0, claims: [] })
})
it('requires the frozen owner contract before any schedule or live request', async () => {
  source.contract.mockRejectedValue(new Error('owner only'))
  await expect(reviewSeasonPeriodLiveFeed('outsider', 't1', 'f1', 1)).rejects.toThrow('owner only')
  expect(source.schedule).not.toHaveBeenCalled()
  expect(source.live).not.toHaveBeenCalled()
})
it('returns safe counts without raw boxes or launch permission', async () => {
  const result = await reviewSeasonPeriodLiveFeed('owner', 't1', 'f1', 1)
  expect(result).toMatchObject({ expectedGames: 1, fetchedGames: 1, finalGames: 1, playerCoverageVerified: false, scoringCertified: false, launchReady: false })
  expect(JSON.stringify(result)).not.toContain('player_box')
  expect(source.live).toHaveBeenCalledWith('live', expect.objectContaining({ sport: 'NBA', date: '2026-10-11' }))
})
it('checks a frozen league against locked provider pairs without exposing player IDs', async () => {
  const config = completeConfig()
  source.contract.mockResolvedValue({ manifest: { config, leagues: [{ key: 'pool-1', name: 'Opening One' }] }, calendar: { assignments: [{ gameId: 'g1', startsAt: '2026-10-12T00:00:00Z', period: 1 }] } })
  source.live.mockResolvedValue({ rows: [{ game_ID: 'g1', status: 'final', season_type: 'Regular Season', player_box: { away_team: { p1: { points: 10 } }, home_team: { p2: { points: 5 } } } }], error: null, notModified: false, unsupported: false })
  source.pairs.mockResolvedValue({ lockedGames: 1, draftedPlayers: 3, draftedPlayersWithoutLockedGame: 1, pairs: [{ providerGameId: 'g1', providerPlayerId: 'p1' }, { providerGameId: 'g1', providerPlayerId: 'absent' }] })
  const result = await reviewSeasonPeriodLiveFeed('owner', 't1', 'f1', 1, 'pool-1')
  expect(result).toMatchObject({ lockedCoverage: { leagueName: 'Opening One', matchedPairs: 1, absentFinalPlayerPairs: 1, publishedGames: 1, publishedGamesPending: 0, publishedGamesWithoutLockedReceipt: 0, draftedPlayers: 3, draftedPlayersWithoutLockedGame: 1, explicitDnpOutcomes: 0, completeGameAndPlayerCoverageVerified: false, scoringCertified: false } })
  expect(result).toMatchObject({ outcomeEvidence: { revisions: 0, candidateDnp: 0, contractVerified: false, scoringCertified: false } })
  expect(JSON.stringify(result)).not.toContain('"providerPlayerId"')
  expect(source.pairs).toHaveBeenCalledWith(expect.any(String), 1, 'owner')
})
it('rejects a league outside the frozen field before provider calls', async () => {
  const config = completeConfig()
  source.contract.mockResolvedValue({ manifest: { config, leagues: [] }, calendar: { assignments: [] } })
  await expect(reviewSeasonPeriodLiveFeed('owner', 't1', 'f1', 1, 'other')).rejects.toThrow('frozen opening league')
  expect(source.schedule).not.toHaveBeenCalled()
  expect(source.live).not.toHaveBeenCalled()
})
