import { describe, expect, it } from 'vitest'

import { buildAfProjection } from '@/lib/af-projections/buildAfProjection'
import type { WeeklyObservation } from '@/lib/af-projections/types'

const STATS = {
  riTeam: 'Washington Commanders',
  position: 'TE',
  riPlayerName: 'Zach Ertz',
  regular_season: {
    games_played: 13,
    receptions: 50,
    receiving_yards: 504,
    DK_fantasy_points: 129.4,
    DK_fantasy_points_per_game: 9.95,
  },
}

function week(w: number, ppr: number): WeeklyObservation {
  return {
    week: w,
    ptsPpr: ppr,
    ptsHalfPpr: ppr - 1,
    ptsStd: ppr - 2,
    offSnaps: null,
    teamOffSnaps: null,
    targets: null,
  }
}

describe('buildAfProjection — refusals', () => {
  it('refuses when no season aggregate can be extracted', () => {
    const r = buildAfProjection({ statsJson: {}, scoringFormat: 'ppr', basisIsPriorSeason: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_games_played')
  })

  it('refuses a sample too small to project from', () => {
    const r = buildAfProjection({
      statsJson: { regular_season: { games_played: 1, DK_fantasy_points_per_game: 30 } },
      scoringFormat: 'ppr',
      basisIsPriorSeason: true,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('insufficient_sample')
      // A one-game 30-point outlier is exactly the "plausible but wrong" number the brief
      // says to refuse rather than emit.
      expect(r.detail).toContain('minimum is 2')
    }
  })

  it('refuses when neither weekly points nor a DK proxy exist', () => {
    const r = buildAfProjection({
      statsJson: { regular_season: { games_played: 10, receptions: 20 } },
      weekly: [],
      scoringFormat: 'ppr',
      basisIsPriorSeason: true,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_scoring_basis')
  })
})

describe('buildAfProjection — basis precedence', () => {
  it('prefers weekly actuals and labels the basis', () => {
    const r = buildAfProjection({
      statsJson: STATS,
      weekly: [week(1, 12), week(2, 12), week(3, 12)],
      scoringFormat: 'ppr',
      basisIsPriorSeason: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.basis).toBe('weekly_actuals_recency')
      expect(r.baselineProjection).toBeCloseTo(12, 1)
      expect(r.weeklyWeeksUsed).toBe(3)
    }
  })

  it('falls back to the DK season proxy when weekly data is absent', () => {
    // The ~47% of players with no sleeperId land here.
    const r = buildAfProjection({
      statsJson: STATS,
      weekly: [],
      scoringFormat: 'ppr',
      basisIsPriorSeason: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.basis).toBe('season_dk_fppg_proxy')
      expect(r.baselineProjection).toBeCloseTo(9.95)
      expect(r.weeklyWeeksUsed).toBe(0)
    }
  })

  it('warns that a DK baseline overstates a non-PPR league', () => {
    const std = buildAfProjection({
      statsJson: STATS,
      weekly: [],
      scoringFormat: 'std',
      basisIsPriorSeason: true,
    })
    expect(std.ok).toBe(true)
    if (std.ok) expect(std.confidence.reasons.join(' ')).toContain('overstates a std league')

    // …and does not attach that caveat when the format matches.
    const ppr = buildAfProjection({
      statsJson: STATS,
      weekly: [],
      scoringFormat: 'ppr',
      basisIsPriorSeason: true,
    })
    if (ppr.ok) expect(ppr.confidence.reasons.join(' ')).not.toContain('overstates')
  })
})

describe('buildAfProjection — honesty invariants', () => {
  it('leaves adjustmentReason null while no adjustment is applied', () => {
    const r = buildAfProjection({
      statsJson: STATS,
      weekly: [week(1, 12)],
      scoringFormat: 'ppr',
      basisIsPriorSeason: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.adjustmentsApplied).toEqual([])
      expect(r.adjustmentReason).toBeNull()
      // No adjustments yet, so the two must be identical — any drift means an
      // unnamed adjustment crept in.
      expect(r.afProjection).toBe(r.baselineProjection)
    }
  })

  it('derives confidence from coverage rather than returning a fixed level', () => {
    const rich = buildAfProjection({
      statsJson: STATS,
      weekly: [week(1, 12), week(2, 12), week(3, 12), week(4, 12), week(5, 12), week(6, 12), week(7, 12), week(8, 12)],
      depthSlot: 'TE',
      injuryStatus: 'Questionable',
      scoringFormat: 'ppr',
      basisIsPriorSeason: false,
    })
    const sparse = buildAfProjection({
      statsJson: { regular_season: { games_played: 3, DK_fantasy_points_per_game: 4 } },
      weekly: [],
      scoringFormat: 'ppr',
      basisIsPriorSeason: true,
    })
    expect(rich.ok && sparse.ok).toBe(true)
    if (rich.ok && sparse.ok) {
      expect(rich.confidence.score).toBeGreaterThan(sparse.confidence.score)
      expect(rich.confidence.level).not.toBe(sparse.confidence.level)
    }
  })

  it('reports a real zero-production player as zero rather than refusing', () => {
    // Played and scored nothing is a fact worth stating; it is not missing data.
    const r = buildAfProjection({
      statsJson: { regular_season: { games_played: 6, DK_fantasy_points_per_game: 0 } },
      weekly: [],
      scoringFormat: 'ppr',
      basisIsPriorSeason: true,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.baselineProjection).toBe(0)
  })
})
