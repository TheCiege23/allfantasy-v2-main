import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { completeConfig } from './helpers/seasonTournamentFixture'

const source = vi.hoisted(() => ({ contract: vi.fn(), schedule: vi.fn(), live: vi.fn(), pairs: vi.fn(), history: vi.fn(), record: vi.fn() }))
vi.mock('@/lib/tournament/seasonScheduleReview', () => ({ loadPublishedScheduleContract: source.contract }))
vi.mock('@/lib/tournament/seasonCalendarVerification', async original => {
  const actual = await original<typeof import('@/lib/tournament/seasonCalendarVerification')>()
  return { ...actual, fetchSeasonCalendarGames: source.schedule }
})
vi.mock('@/lib/workers/providers/rollingInsightsRest', () => ({ riFetchRows: source.live }))
vi.mock('@/lib/tournament/seasonScoreLedger', () => ({ readSeasonOpeningLockedProviderPairs: source.pairs }))
vi.mock('@/lib/tournament/seasonOutcomeEvidenceStore', () => ({ readSeasonOutcomeCandidates: source.history, recordSeasonOutcomeCandidate: source.record }))
import { captureSeasonObservedBoxCandidates } from '@/lib/tournament/seasonObservedBoxCapture'

const startsAt = '2026-10-11T17:00:00Z'
const liveGame = { game_ID: 'g1', status: 'completed', season_type: 'Regular Season',
  player_box: { away_team: { p1: { status: 'ACT', points: 0 } }, home_team: { p2: { status: 'ACT', points: 3 } } } }

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-13T18:00:00Z'))
  const config = completeConfig()
  source.contract.mockResolvedValue({ manifest: { config, leagues: [{ key: 'pool-1' }] }, calendar: { assignments: [{ gameId: 'g1', startsAt, period: 1 }] } })
  source.schedule.mockResolvedValue({ games: [{ gameId: 'g1', startTime: startsAt, seasonType: 'regular', replacedBy: null, status: 'completed' }] })
  source.live.mockResolvedValue({ rows: [liveGame], error: null, notModified: false, unsupported: false })
  source.pairs.mockResolvedValue({ gameBindings: [{ gameId: 'g1', providerGameId: 'g1' }], pairs: [{ providerGameId: 'g1', providerPlayerId: 'p1' }] })
  source.history.mockResolvedValue({ revision: 0, claims: [] })
  source.record.mockResolvedValue({ revision: 1, existing: false })
})
afterEach(() => vi.useRealTimers())

it('captures only bounded observed lines from a final, published game', async () => {
  const pending = captureSeasonObservedBoxCandidates('owner', 't1', 'f1', 'pool-1', 1, '2026-10-11')
  await vi.advanceTimersByTimeAsync(6000)
  expect(await pending).toMatchObject({ fetchedGames: 1, saved: 1, revision: 1, contractVerified: false, scoringCertified: false, launchReady: false })
  expect(source.live).toHaveBeenCalledWith('live', expect.objectContaining({ sport: 'NBA', date: '2026-10-11' }))
  expect(source.record).toHaveBeenCalledWith('owner', 't1', 'f1', 'pool-1', 1, expect.stringMatching(/^boxline-/),
    expect.objectContaining({ outcome: 'box_line_present', source: expect.objectContaining({ contract: 'unverified', observedAt: '2026-10-13T18:00:06.000Z' }) }),
    expect.objectContaining({ providerPlayerId: 'p1' }))
  expect(JSON.stringify(await pending)).not.toContain('playerLine')
})

it('blocks schedule drift and duplicate provider rows before any evidence write', async () => {
  source.schedule.mockResolvedValueOnce({ games: [{ gameId: 'g1', startTime: '2026-10-12T17:00:00Z', seasonType: 'regular' }] })
  await expect(captureSeasonObservedBoxCandidates('owner', 't1', 'f1', 'pool-1', 1, '2026-10-11')).rejects.toThrow('schedule differs')
  expect(source.live).not.toHaveBeenCalled()
  source.live.mockResolvedValueOnce({ rows: [liveGame, liveGame], error: null, notModified: false, unsupported: false })
  const pending = captureSeasonObservedBoxCandidates('owner', 't1', 'f1', 'pool-1', 1, '2026-10-11')
  const rejected = expect(pending).rejects.toThrow('duplicate rows')
  await vi.advanceTimersByTimeAsync(6000)
  await rejected
  expect(source.record).not.toHaveBeenCalled()
})

it('uses the verified canonical-to-provider game binding when IDs differ', async () => {
  source.pairs.mockResolvedValue({ gameBindings: [{ gameId: 'g1', providerGameId: 'ri-g1' }],
    pairs: [{ providerGameId: 'ri-g1', providerPlayerId: 'p1' }] })
  source.live.mockResolvedValue({ rows: [{ ...liveGame, game_ID: 'ri-g1' }], error: null, notModified: false, unsupported: false })
  const pending = captureSeasonObservedBoxCandidates('owner', 't1', 'f1', 'pool-1', 1, '2026-10-11')
  await vi.advanceTimersByTimeAsync(6000)
  expect(await pending).toMatchObject({ fetchedGames: 1, saved: 1 })
  expect(source.record).toHaveBeenCalledWith('owner', 't1', 'f1', 'pool-1', 1, expect.any(String),
    expect.objectContaining({ subject: { kind: 'player_game', providerGameId: 'ri-g1', providerPlayerId: 'p1' } }), expect.any(Object))
})

it('does not accept a coincidental provider row without a verified published-game binding', async () => {
  source.pairs.mockResolvedValue({ gameBindings: [{ gameId: 'g1', providerGameId: null }],
    pairs: [{ providerGameId: null, providerPlayerId: 'p1' }] })
  const pending = captureSeasonObservedBoxCandidates('owner', 't1', 'f1', 'pool-1', 1, '2026-10-11')
  await vi.advanceTimersByTimeAsync(6000)
  expect(await pending).toMatchObject({ fetchedGames: 0, saved: 0, unresolvedPairs: 1 })
  expect(source.record).not.toHaveBeenCalled()
})

it('resumes a ten-receipt batch after a partial write failure without duplicating saved candidates', async () => {
  const ids = Array.from({ length: 12 }, (_, index) => `p${index + 1}`)
  source.pairs.mockResolvedValue({ gameBindings: [{ gameId: 'g1', providerGameId: 'g1' }],
    pairs: ids.map(providerPlayerId => ({ providerGameId: 'g1', providerPlayerId })) })
  source.live.mockResolvedValue({ rows: [{ ...liveGame, player_box: { away_team: Object.fromEntries(ids.map(id => [id, { status: 'ACT', points: 0 }])),
    home_team: { other: { status: 'ACT', points: 1 } } } }], error: null, notModified: false, unsupported: false })
  const claims: Array<{ claim: any; artifact: Record<string, unknown> }> = []
  source.record.mockImplementation(async (_owner, _t, _f, _l, _p, _request, claim, artifact) => {
    if (claims.length === 4 && source.record.mock.calls.length === 5) throw new Error('transient audit write failure')
    claims.push({ claim, artifact })
    return { revision: claims.length, existing: false }
  })
  source.history.mockImplementation(async () => ({ revision: claims.length, claims: claims.map(({ claim }) => claim) }))
  const first = captureSeasonObservedBoxCandidates('owner', 't1', 'f1', 'pool-1', 1, '2026-10-11')
  const rejected = expect(first).rejects.toThrow('transient audit write failure')
  await vi.advanceTimersByTimeAsync(6000)
  await rejected
  expect(claims).toHaveLength(4)
  const second = captureSeasonObservedBoxCandidates('owner', 't1', 'f1', 'pool-1', 1, '2026-10-11')
  await vi.advanceTimersByTimeAsync(6000)
  expect(await second).toMatchObject({ saved: 8, revision: 12, deferredByLimit: 0, unchangedPairs: 4 })
  expect(new Set(claims.map(({ claim }) => claim.subject.providerPlayerId)).size).toBe(12)
})
