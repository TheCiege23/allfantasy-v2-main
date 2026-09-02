/**
 * The trade seam now reads the AllFantasy engine's own projections first.
 *
 * 🛑 WHAT THIS CLOSES. `lib/af-projections/` computes `AFProjectionSnapshot` on a daily cron, and
 * nothing in the valuation chain read it. The chain read `fantasy_projections` — a DIFFERENT table
 * — and `loadProjectionRows` filters `source: { not: 'allfantasy' }`, so even the mirror rows the
 * writer copies there were excluded by design. The calculator was shut out twice over.
 *
 * The port is injected, so none of this touches a database.
 */

import { describe, expect, it } from 'vitest'
import {
  resolveTradeEnrichment,
  type TradeEnrichmentPort,
} from '@/lib/decision-os/trade/enrichmentPort'

const NOW = new Date('2026-09-02T00:00:00.000Z')

/** A port that answers nothing, so each test opts into exactly the sources it means to exercise. */
function silentPort(over: Partial<TradeEnrichmentPort> = {}): TradeEnrichmentPort {
  return {
    loadAdp: async () => [],
    resolveMetadata: async () => ({ byId: new Map() }) as never,
    loadProjections: async () => [],
    loadAfProjections: async () => [],
    loadMarketValue: async () => [],
    loadIdpValue: async () => [],
    ...over,
  }
}

const afRow = (over: Record<string, unknown> = {}) => ({
  playerId: 'p1',
  sport: 'NFL',
  season: 2026,
  week: 5,
  afProjection: 19.5,
  rosProjection: 253.5, // 19.5 x 13
  rosWeeksRemaining: 13,
  confidenceLevel: 'high',
  computedAt: NOW,
  ...over,
})

describe('AF projections are preferred', () => {
  it('uses rosProjection — NOT the per-game afProjection', async () => {
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], season: 2026, week: 5 },
      silentPort({ loadAfProjections: async () => [afRow()] as never }),
    )
    expect(res.enrichment.projectionByPlayerId?.p1).toBe(253.5)
    // 🛑 The regression that matters: reading afProjection would give 19.5 and understate ~13x.
    expect(res.enrichment.projectionByPlayerId?.p1).not.toBe(19.5)
    expect(res.valuationSource).toContain('af_projection_snapshot')
  })

  it('beats a provider row for the same player', async () => {
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], season: 2026, week: 5 },
      silentPort({
        loadAfProjections: async () => [afRow()] as never,
        loadProjections: async () => [{
          playerId: 'p1', sport: 'NFL', season: '2026', week: 5,
          scoringPresetId: 'ppr', projectedPoints: 11.1, stats: {},
          source: 'sleeper', fetchedAt: NOW, expiresAt: new Date('2027-01-01'),
        }] as never,
      }),
    )
    expect(res.enrichment.projectionByPlayerId?.p1).toBe(253.5)
  })

  it('falls back to the provider for players AF does not cover', async () => {
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1', 'p2'], season: 2026, week: 5 },
      silentPort({
        loadAfProjections: async () => [afRow()] as never,        // p1 only
        loadProjections: async () => [{
          playerId: 'p2', sport: 'NFL', season: '2026', week: 5,
          scoringPresetId: 'ppr', projectedPoints: 88, stats: {},
          source: 'sleeper', fetchedAt: NOW, expiresAt: new Date('2027-01-01'),
        }] as never,
      }),
    )
    expect(res.enrichment.projectionByPlayerId?.p1).toBe(253.5)  // AF
    expect(res.enrichment.projectionByPlayerId?.p2).toBe(88)     // provider
    expect(res.valuationSource).toContain('af_projection_snapshot')
    expect(res.valuationSource).toContain('fantasy_projection')
  })

  it('takes the week-scoped row over the season-long one', async () => {
    // The port returns them week-desc, so the week row arrives first.
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], season: 2026, week: 5 },
      silentPort({
        loadAfProjections: async () => [
          afRow({ week: 5, rosProjection: 253.5 }),
          afRow({ week: null, rosProjection: 999 }),
        ] as never,
      }),
    )
    expect(res.enrichment.projectionByPlayerId?.p1).toBe(253.5)
  })
})

describe("re-projecting onto the league's own horizon", () => {
  it('shortens a 17-week total for a league whose season ends earlier', async () => {
    const res = await resolveTradeEnrichment(
      {
        sport: 'NFL', playerIds: ['p1'], season: 2026, week: 1,
        weeksRemaining: 14, // this league's championship is earlier
      },
      silentPort({
        loadAfProjections: async () => [
          afRow({ week: 1, rosProjection: 340, rosWeeksRemaining: 17 }),
        ] as never,
      }),
    )
    // 340 / 17 = 20 per game; x14 = 280.
    expect(res.enrichment.projectionByPlayerId?.p1).toBeCloseTo(280, 1)
  })

  it('leaves the stored total alone when the league horizon is unknown', async () => {
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], season: 2026, week: 1 },
      silentPort({
        loadAfProjections: async () => [
          afRow({ week: 1, rosProjection: 340, rosWeeksRemaining: 17 }),
        ] as never,
      }),
    )
    // Inheriting the stored horizon is honest; inventing one is not.
    expect(res.enrichment.projectionByPlayerId?.p1).toBe(340)
  })

  it('skips a row whose divisor is missing rather than re-projecting blind', async () => {
    const res = await resolveTradeEnrichment(
      {
        sport: 'NFL', playerIds: ['p1'], season: 2026, week: 1, weeksRemaining: 14,
      },
      silentPort({
        loadAfProjections: async () => [
          afRow({ rosProjection: 340, rosWeeksRemaining: null }),
        ] as never,
      }),
    )
    expect(res.enrichment.projectionByPlayerId?.p1).toBeUndefined()
  })
})

describe('honest refusals — a silent join failure must be visible', () => {
  it('warns when AF returned NO ROWS at all', async () => {
    /*
     * 🛑 THE FAILURE THIS EXISTS TO CATCH. `AFProjectionSnapshot.playerId` and the ids passed in
     * are different id spaces unless the registry resolved them. A join across mismatched spaces
     * returns zero rows and looks EXACTLY like "the engine has not computed these players yet".
     */
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], season: 2026, week: 5 },
      silentPort(),
    )
    expect(res.warnings).toContain('af_projection_no_rows')
  })

  it('warns when rows came back but none carried a ROS value', async () => {
    // Rows written before the ROS columns existed. Different diagnosis, different warning.
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], season: 2026, week: 5 },
      silentPort({
        loadAfProjections: async () => [afRow({ rosProjection: null })] as never,
      }),
    )
    expect(res.warnings).toContain('af_projection_rows_without_ros')
    expect(res.warnings).not.toContain('af_projection_no_rows')
  })

  it('degrades to the provider when the AF source throws', async () => {
    const res = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], season: 2026, week: 5 },
      silentPort({
        loadAfProjections: async () => { throw new Error('boom') },
        loadProjections: async () => [{
          playerId: 'p1', sport: 'NFL', season: '2026', week: 5,
          scoringPresetId: 'ppr', projectedPoints: 42, stats: {},
          source: 'sleeper', fetchedAt: NOW, expiresAt: new Date('2027-01-01'),
        }] as never,
      }),
    )
    expect(res.warnings).toContain('af_projection_source_unavailable')
    expect(res.enrichment.projectionByPlayerId?.p1).toBe(42)
  })

  it('never treats a zero ROS as a refusal, or a refusal as a zero', async () => {
    const zero = await resolveTradeEnrichment(
      { sport: 'NFL', playerIds: ['p1'], season: 2026, week: 5 },
      silentPort({ loadAfProjections: async () => [afRow({ rosProjection: 0 })] as never }),
    )
    // A real 0 is a real projection and must survive.
    expect(zero.enrichment.projectionByPlayerId?.p1).toBe(0)
  })
})
