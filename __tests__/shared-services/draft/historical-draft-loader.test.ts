import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDraftSessionFindMany, mockLeagueFindUnique, mockDraftPickFindMany } = vi.hoisted(() => ({
  mockDraftSessionFindMany: vi.fn(),
  mockLeagueFindUnique: vi.fn(),
  mockDraftPickFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findMany: mockDraftSessionFindMany },
    league: { findUnique: mockLeagueFindUnique },
    draftPick: { findMany: mockDraftPickFindMany },
  },
}))

import { loadHistoricalDraftPickSamples } from '@/lib/shared-services/draft/backtest/HistoricalDraftLoader'

const BASE_SESSION = { id: 'session-1', leagueId: 'league-1', completedAt: new Date('2026-01-01') }

function makePick(overall: number, round: number, rosterId = 'roster-1') {
  return { overall, round, rosterId, position: 'RB', playerName: `Player ${overall}`, playerId: `p${overall}` }
}

describe('loadHistoricalDraftPickSamples', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLeagueFindUnique.mockResolvedValue({ platform: 'sleeper' })
  })

  it('queries only completed draft sessions', async () => {
    mockDraftSessionFindMany.mockResolvedValue([])
    await loadHistoricalDraftPickSamples()
    expect(mockDraftSessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'completed' }, orderBy: { completedAt: 'desc' }, take: 20 })
    )
  })

  it('samples round > 1 picks and excludes round 1', async () => {
    mockDraftSessionFindMany.mockResolvedValue([BASE_SESSION])
    mockDraftPickFindMany.mockResolvedValue([makePick(1, 1), makePick(13, 2), makePick(25, 3)])

    const result = await loadHistoricalDraftPickSamples()

    expect(result.samples).toHaveLength(2)
    expect(result.samples.every((s) => s.round > 1)).toBe(true)
    expect(result.totalCandidates).toBe(2)
  })

  it('respects maxPicksPerSession by sampling evenly', async () => {
    mockDraftSessionFindMany.mockResolvedValue([BASE_SESSION])
    const picks = Array.from({ length: 20 }, (_, i) => makePick(i + 13, 2))
    mockDraftPickFindMany.mockResolvedValue(picks)

    const result = await loadHistoricalDraftPickSamples({ maxPicksPerSession: 5 })
    expect(result.samples.length).toBeLessThanOrEqual(5)
  })

  it('includes natively-created leagues', async () => {
    mockDraftSessionFindMany.mockResolvedValue([BASE_SESSION])
    mockLeagueFindUnique.mockResolvedValue({ platform: 'native' })
    mockDraftPickFindMany.mockResolvedValue([makePick(13, 2)])

    const result = await loadHistoricalDraftPickSamples()
    expect(result.samples[0].platform).toBe('native')
  })

  it('skips a session whose League no longer exists', async () => {
    mockDraftSessionFindMany.mockResolvedValue([BASE_SESSION])
    mockLeagueFindUnique.mockResolvedValue(null)

    const result = await loadHistoricalDraftPickSamples()
    expect(result.samples).toEqual([])
    expect(result.skipped).toEqual([{ sessionId: 'session-1', overall: null, reason: 'league_not_found' }])
  })

  it('skips a session with an unrecognized platform', async () => {
    mockDraftSessionFindMany.mockResolvedValue([BASE_SESSION])
    mockLeagueFindUnique.mockResolvedValue({ platform: 'some_unknown_platform' })

    const result = await loadHistoricalDraftPickSamples()
    expect(result.skipped).toEqual([{ sessionId: 'session-1', overall: null, reason: 'unrecognized_platform:some_unknown_platform' }])
  })

  it('skips a session with no round > 1 picks', async () => {
    mockDraftSessionFindMany.mockResolvedValue([BASE_SESSION])
    mockDraftPickFindMany.mockResolvedValue([makePick(1, 1)])

    const result = await loadHistoricalDraftPickSamples()
    expect(result.samples).toEqual([])
    expect(result.skipped).toEqual([{ sessionId: 'session-1', overall: null, reason: 'no_round2_plus_picks' }])
  })

  it('skips a pick with missing fields', async () => {
    mockDraftSessionFindMany.mockResolvedValue([BASE_SESSION])
    mockDraftPickFindMany.mockResolvedValue([{ overall: 13, round: 2, rosterId: null, position: 'RB', playerName: null, playerId: null }])

    const result = await loadHistoricalDraftPickSamples()
    expect(result.samples).toEqual([])
    expect(result.skipped).toEqual([{ sessionId: 'session-1', overall: 13, reason: 'missing_pick_fields' }])
  })

  it('handles an empty corpus cleanly', async () => {
    mockDraftSessionFindMany.mockResolvedValue([])
    const result = await loadHistoricalDraftPickSamples()
    expect(result).toEqual({ samples: [], skipped: [], totalCandidates: 0 })
  })
})
