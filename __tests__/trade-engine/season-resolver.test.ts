/**
 * Decision OS — Trade Learning Phase 10: Canonical Season Resolution.
 *
 * Direct coverage of lib/trade-engine/season-resolver.ts, the single
 * canonical season-determination path that replaced ~11 independent
 * hardcoded `2025` constants/defaults scattered across the trade-learning
 * subsystem (see docs/TRADE_LEARNING_PRE_ENABLEMENT_AUDIT.md §11 and
 * docs/TRADE_LEARNING_SHADOW_ROLLOUT.md).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const { mockLeagueAggregate } = vi.hoisted(() => ({
  mockLeagueAggregate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { aggregate: mockLeagueAggregate },
  },
}))

import {
  computeSeasonFromDate,
  resolveCurrentTradeLearningSeason,
  invalidateSeasonResolverCache,
} from '@/lib/trade-engine/season-resolver'

describe('computeSeasonFromDate — deterministic date-based fallback', () => {
  it('resolves a September date to that same calendar year (season start)', () => {
    expect(computeSeasonFromDate(new Date('2026-09-15T00:00:00.000Z'))).toBe(2026)
  })

  it('resolves a December date to that same calendar year', () => {
    expect(computeSeasonFromDate(new Date('2026-12-31T23:59:59.000Z'))).toBe(2026)
  })

  it('resolves a January date to the PRIOR calendar year (season still in progress)', () => {
    expect(computeSeasonFromDate(new Date('2027-01-15T00:00:00.000Z'))).toBe(2026)
  })

  it('resolves an August date to the PRIOR calendar year (offseason, season not yet started)', () => {
    expect(computeSeasonFromDate(new Date('2026-08-31T23:59:59.000Z'))).toBe(2025)
  })

  it('is a pure function of its input, not wall-clock time — same input always yields same output', () => {
    const d = new Date('2026-03-01T00:00:00.000Z')
    expect(computeSeasonFromDate(d)).toBe(computeSeasonFromDate(d))
  })
})

describe('resolveCurrentTradeLearningSeason — primary MAX(League.season) path', () => {
  beforeEach(() => invalidateSeasonResolverCache())
  afterEach(() => {
    vi.clearAllMocks()
    invalidateSeasonResolverCache()
  })

  it('resolves the freshest real season seen across League rows', async () => {
    mockLeagueAggregate.mockResolvedValue({ _max: { season: 2026 } })

    const season = await resolveCurrentTradeLearningSeason()

    expect(season).toBe(2026)
    expect(mockLeagueAggregate).toHaveBeenCalledWith({ _max: { season: true } })
  })

  it('future rollover: a higher real season value is picked up automatically, no code change needed', async () => {
    mockLeagueAggregate.mockResolvedValue({ _max: { season: 2027 } })

    const season = await resolveCurrentTradeLearningSeason()

    expect(season).toBe(2027)
  })

  it('caches the resolved value across calls within the TTL (does not re-query every time)', async () => {
    mockLeagueAggregate.mockResolvedValue({ _max: { season: 2026 } })

    const first = await resolveCurrentTradeLearningSeason()
    const second = await resolveCurrentTradeLearningSeason()

    expect(first).toBe(2026)
    expect(second).toBe(2026)
    expect(mockLeagueAggregate).toHaveBeenCalledTimes(1)
  })

  it('re-queries after the cache is explicitly invalidated', async () => {
    mockLeagueAggregate.mockResolvedValueOnce({ _max: { season: 2026 } })
    mockLeagueAggregate.mockResolvedValueOnce({ _max: { season: 2027 } })

    const first = await resolveCurrentTradeLearningSeason()
    invalidateSeasonResolverCache()
    const second = await resolveCurrentTradeLearningSeason()

    expect(first).toBe(2026)
    expect(second).toBe(2027)
    expect(mockLeagueAggregate).toHaveBeenCalledTimes(2)
  })

  it('falls back to the deterministic date-based computation on a cold start (no League rows exist)', async () => {
    mockLeagueAggregate.mockResolvedValue({ _max: { season: null } })

    const season = await resolveCurrentTradeLearningSeason()

    expect(season).toBe(computeSeasonFromDate())
  })

  it('fails safe to the date-based fallback if the database query itself throws', async () => {
    mockLeagueAggregate.mockRejectedValue(new Error('connection lost'))

    const season = await resolveCurrentTradeLearningSeason()

    expect(season).toBe(computeSeasonFromDate())
  })
})
