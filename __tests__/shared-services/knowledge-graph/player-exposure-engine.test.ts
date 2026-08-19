import { describe, expect, it } from 'vitest'
import {
  buildPlayerExposureConfidenceEnvelope,
  computePlayerExposureMetrics,
  type ManagerRosterSnapshot,
} from '@/lib/shared-services/knowledge-graph/PlayerExposureEngine'

describe('computePlayerExposureMetrics', () => {
  it('returns zero exposure with no rosters — never a fabricated share', () => {
    const metrics = computePlayerExposureMetrics('player-1', [])
    expect(metrics.totalLeagueCount).toBe(0)
    expect(metrics.rosteredInLeagueCount).toBe(0)
    expect(metrics.exposureShare).toBe(0)
  })

  it('computes exposure share across a manager\'s leagues', () => {
    const rosters: ManagerRosterSnapshot[] = [
      { leagueId: 'league-1', playerIds: ['player-1', 'player-2'] },
      { leagueId: 'league-2', playerIds: ['player-2'] },
      { leagueId: 'league-3', playerIds: ['player-1'] },
      { leagueId: 'league-4', playerIds: [] },
    ]
    const metrics = computePlayerExposureMetrics('player-1', rosters)
    expect(metrics.totalLeagueCount).toBe(4)
    expect(metrics.rosteredInLeagueCount).toBe(2)
    expect(metrics.exposureShare).toBeCloseTo(0.5)
  })

  it('reports full exposure when every league rosters the player', () => {
    const rosters: ManagerRosterSnapshot[] = [
      { leagueId: 'league-1', playerIds: ['player-1'] },
      { leagueId: 'league-2', playerIds: ['player-1'] },
    ]
    const metrics = computePlayerExposureMetrics('player-1', rosters)
    expect(metrics.exposureShare).toBe(1)
  })
})

describe('buildPlayerExposureConfidenceEnvelope', () => {
  const sourceAttribution = { source: 'af_native' as const, emittedFrom: 'test', recordedAt: new Date() }

  it('includes all seven confidence envelope fields', () => {
    const metrics = computePlayerExposureMetrics('player-1', [{ leagueId: 'league-1', playerIds: ['player-1'] }])
    const envelope = buildPlayerExposureConfidenceEnvelope(metrics, sourceAttribution)
    expect(envelope).toHaveProperty('confidence')
    expect(envelope).toHaveProperty('freshness')
    expect(envelope).toHaveProperty('evidence')
    expect(envelope).toHaveProperty('sampleSize')
    expect(envelope).toHaveProperty('sourceAttribution')
    expect(envelope).toHaveProperty('risk')
    expect(envelope).toHaveProperty('uncertainty')
  })

  it('computes a real Wald-interval uncertainty band around the exposure share', () => {
    const metrics = computePlayerExposureMetrics('player-1', [
      { leagueId: 'league-1', playerIds: ['player-1'] },
      { leagueId: 'league-2', playerIds: [] },
      { leagueId: 'league-3', playerIds: [] },
      { leagueId: 'league-4', playerIds: [] },
    ])
    const envelope = buildPlayerExposureConfidenceEnvelope(metrics, sourceAttribution)
    expect(envelope.uncertainty).not.toBeNull()
    expect(envelope.uncertainty!.low).toBeLessThanOrEqual(metrics.exposureShare)
    expect(envelope.uncertainty!.high).toBeGreaterThanOrEqual(metrics.exposureShare)
    expect(envelope.uncertainty!.low).toBeGreaterThanOrEqual(0)
    expect(envelope.uncertainty!.high).toBeLessThanOrEqual(1)
  })

  it('returns null uncertainty with zero leagues (no basis for an interval)', () => {
    const metrics = computePlayerExposureMetrics('player-1', [])
    const envelope = buildPlayerExposureConfidenceEnvelope(metrics, sourceAttribution)
    expect(envelope.uncertainty).toBeNull()
  })

  it('confidence scales with league count, capped at 1 around 10 leagues', () => {
    const zero = buildPlayerExposureConfidenceEnvelope(computePlayerExposureMetrics('p', []), sourceAttribution)
    expect(zero.confidence).toBe(0)

    const ten = buildPlayerExposureConfidenceEnvelope(
      computePlayerExposureMetrics('p', Array.from({ length: 10 }, (_, i) => ({ leagueId: `l${i}`, playerIds: [] }))),
      sourceAttribution
    )
    expect(ten.confidence).toBe(1)
  })

  it('leaves evidence empty and documents why — exposure is a live snapshot, not discrete signals', () => {
    const metrics = computePlayerExposureMetrics('player-1', [{ leagueId: 'league-1', playerIds: ['player-1'] }])
    const envelope = buildPlayerExposureConfidenceEnvelope(metrics, sourceAttribution)
    expect(envelope.evidence).toEqual([])
  })

  it('source attribution reflects af_native, never a fabricated provider', () => {
    const metrics = computePlayerExposureMetrics('player-1', [{ leagueId: 'league-1', playerIds: [] }])
    const envelope = buildPlayerExposureConfidenceEnvelope(metrics, sourceAttribution)
    expect(envelope.sourceAttribution).toEqual([sourceAttribution])
  })
})
