import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockClaimFindMany, mockResultFindFirst, mockLeagueFindUnique } = vi.hoisted(() => ({
  mockClaimFindMany: vi.fn(),
  mockResultFindFirst: vi.fn(),
  mockLeagueFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    waiverClaim: { findMany: mockClaimFindMany },
    waiverResult: { findFirst: mockResultFindFirst },
    league: { findUnique: mockLeagueFindUnique },
  },
}))

import { loadHistoricalWaiverSamples } from '@/lib/shared-services/waiver/backtest/HistoricalWaiverLoader'

const BASE_CLAIM = {
  id: 'claim-1',
  leagueId: 'league-1',
  rosterId: 'roster-1',
  addPlayerId: 'p1',
  dropPlayerId: 'p9',
  faabBid: 12,
  priorityOrder: 2,
  status: 'processed',
  processedAt: new Date('2026-01-01T00:00:00.000Z'),
  createdAt: new Date('2025-12-31T00:00:00.000Z'),
  roster: { platformUserId: 'manager-1' },
}

describe('loadHistoricalWaiverSamples', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('queries only terminal (processed or failed) waiver claims', async () => {
    mockClaimFindMany.mockResolvedValue([])
    await loadHistoricalWaiverSamples()
    expect(mockClaimFindMany).toHaveBeenCalledWith({
      where: { status: { in: ['processed', 'failed'] } },
      orderBy: { processedAt: 'desc' },
      take: 200,
      include: { roster: { select: { platformUserId: true } } },
    })
  })

  it('normalizes a complete, awarded, provider-backed claim into a backtestable sample', async () => {
    mockClaimFindMany.mockResolvedValue([BASE_CLAIM])
    mockResultFindFirst.mockResolvedValue({ faabDelta: -12, resultType: 'awarded' })
    mockLeagueFindUnique.mockResolvedValue({ platform: 'sleeper' })

    const result = await loadHistoricalWaiverSamples()

    expect(result.skipped).toEqual([])
    expect(result.samples).toEqual([
      {
        claimId: 'claim-1',
        leagueId: 'league-1',
        rosterId: 'roster-1',
        platform: 'sleeper',
        managerKey: 'manager-1',
        addPlayerId: 'p1',
        addPlayerName: null,
        dropPlayerId: 'p9',
        faabBid: 12,
        priorityOrder: 2,
        realOutcome: 'awarded',
        realFaabDelta: -12,
        processedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
  })

  it('maps a failed claim status to the failed real outcome', async () => {
    mockClaimFindMany.mockResolvedValue([{ ...BASE_CLAIM, status: 'failed' }])
    mockResultFindFirst.mockResolvedValue({ faabDelta: null, resultType: 'failed' })
    mockLeagueFindUnique.mockResolvedValue({ platform: 'sleeper' })

    const result = await loadHistoricalWaiverSamples()
    expect(result.samples[0].realOutcome).toBe('failed')
  })

  it('includes natively-created leagues (unlike Trade OS backtest)', async () => {
    mockClaimFindMany.mockResolvedValue([BASE_CLAIM])
    mockResultFindFirst.mockResolvedValue({ faabDelta: null, resultType: 'awarded' })
    mockLeagueFindUnique.mockResolvedValue({ platform: 'native' })

    const result = await loadHistoricalWaiverSamples()
    expect(result.skipped).toEqual([])
    expect(result.samples[0].platform).toBe('native')
  })

  it('skips a claim with no matching WaiverResult', async () => {
    mockClaimFindMany.mockResolvedValue([BASE_CLAIM])
    mockResultFindFirst.mockResolvedValue(null)

    const result = await loadHistoricalWaiverSamples()
    expect(result.samples).toEqual([])
    expect(result.skipped).toEqual([{ claimId: 'claim-1', reason: 'no_waiver_result' }])
  })

  it('skips a claim whose League no longer exists', async () => {
    mockClaimFindMany.mockResolvedValue([BASE_CLAIM])
    mockResultFindFirst.mockResolvedValue({ faabDelta: null, resultType: 'awarded' })
    mockLeagueFindUnique.mockResolvedValue(null)

    const result = await loadHistoricalWaiverSamples()
    expect(result.skipped).toEqual([{ claimId: 'claim-1', reason: 'league_not_found' }])
  })

  it('skips a claim with an unrecognized platform value', async () => {
    mockClaimFindMany.mockResolvedValue([BASE_CLAIM])
    mockResultFindFirst.mockResolvedValue({ faabDelta: null, resultType: 'awarded' })
    mockLeagueFindUnique.mockResolvedValue({ platform: 'some_unknown_platform' })

    const result = await loadHistoricalWaiverSamples()
    expect(result.skipped).toEqual([{ claimId: 'claim-1', reason: 'unrecognized_platform:some_unknown_platform' }])
  })

  it('handles an empty corpus cleanly', async () => {
    mockClaimFindMany.mockResolvedValue([])
    const result = await loadHistoricalWaiverSamples()
    expect(result).toEqual({ samples: [], skipped: [], totalCandidates: 0 })
  })

  it('respects a custom limit', async () => {
    mockClaimFindMany.mockResolvedValue([])
    await loadHistoricalWaiverSamples({ limit: 50 })
    expect(mockClaimFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }))
  })

  it('falls back to createdAt when processedAt is null', async () => {
    mockClaimFindMany.mockResolvedValue([{ ...BASE_CLAIM, processedAt: null }])
    mockResultFindFirst.mockResolvedValue({ faabDelta: null, resultType: 'awarded' })
    mockLeagueFindUnique.mockResolvedValue({ platform: 'sleeper' })

    const result = await loadHistoricalWaiverSamples()
    expect(result.samples[0].processedAt).toBe('2025-12-31T00:00:00.000Z')
  })
})
