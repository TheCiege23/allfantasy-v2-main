import { describe, expect, it } from 'vitest'
import { calibrationFor, deriveProjectionCalibration } from '@/lib/af-projections/calibrationMath'
import type { ProjectionAccuracyRecord } from '@/lib/projections/projectionAccuracy'
import { buildAfProjection } from '@/lib/af-projections/buildAfProjection'

function record(week: number, basisBias: number, exactBias = basisBias): ProjectionAccuracyRecord {
  return {
    version: 1,
    season: 2026,
    week,
    computedAt: new Date(2026, 8, week).toISOString(),
    status: 'scored',
    scoring: 'test',
    actualsScored: 100,
    actualsUnscoreable: 0,
    idpExcludedPairs: 0,
    afVsSleeper: null,
    sources: {
      allfantasy: {
        overall: { n: 60, mae: 5, bias: basisBias },
        byPosition: {},
        byBasis: { weekly_actuals_recency: { n: 60, mae: 5, bias: basisBias } },
        byPositionBasis: { 'WR|weekly_actuals_recency': { n: 30, mae: 5, bias: exactBias } },
        methods: { rescoredFromStatLine: 0, projectedPointsColumn: 60 },
        withoutActual: 0,
      },
    },
  }
}

describe('projection accuracy calibration', () => {
  it('reverses measured bias, shrinks it toward zero, and prefers position evidence', () => {
    const map = deriveProjectionCalibration([record(1, 4, 2), record(2, 4, 2)])
    expect(map.weekly_actuals_recency?.points).toBeLessThan(0)
    expect(map.weekly_actuals_recency?.points).toBeGreaterThanOrEqual(-2.5)
    expect(calibrationFor(map, 'weekly_actuals_recency', 'WR')?.scope).toBe('position_basis')
    expect(calibrationFor(map, 'weekly_actuals_recency', 'RB')?.scope).toBe('basis')
  })

  it('withholds small samples and never calibrates sleeper pass-through projections', () => {
    const small = record(1, 4)
    small.sources.allfantasy!.byBasis!.weekly_actuals_recency!.n = 5
    small.sources.allfantasy!.byPositionBasis!['WR|weekly_actuals_recency']!.n = 5
    small.sources.allfantasy!.byBasis!.sleeper_weekly_projection = { n: 100, mae: 1, bias: 4 }
    expect(deriveProjectionCalibration([small])).toEqual({})
  })

  it('applies feedback to an independent forecast and leaves the provider forecast unchanged', () => {
    const base = {
      aggregate: { gamesPlayed: 8, components: {}, position: 'WR', team: 'BUF', playerName: 'Receiver', dkPointsPerGame: 12 },
      weekly: [{ week: 8, ptsPpr: 10, ptsHalfPpr: 9, ptsStd: 8, offSnaps: 50, teamOffSnaps: 65, targets: 7 }],
      scoringFormat: 'ppr' as const,
      basisIsPriorSeason: false,
      position: 'WR',
      accuracyCalibration: { weekly_actuals_recency: { points: -1.5, sample: 120, weeks: 4, scope: 'basis' as const } },
    }
    const independent = buildAfProjection(base)
    expect(independent.ok && independent.afProjection).toBe(8.5)
    expect(independent.ok && independent.calibration?.sample).toBe(120)

    const forward = buildAfProjection({ ...base, sleeperProjection: { pts_ppr: 15 } })
    expect(forward.ok && forward.afProjection).toBe(15)
    expect(forward.ok && forward.calibration).toBeNull()
  })
})
