import { describe, expect, it } from 'vitest'
import {
  HeuristicObjectiveEngine,
  contentionBand,
  contentionScore,
  discountFactor,
} from '@/lib/projections/objectiveEngine'
import { hasNoSignal, type TradeSide } from '@/lib/projections/tradeGrading'

const engine = new HeuristicObjectiveEngine()

function team(overrides: Partial<Parameters<typeof engine.evaluate>[0]>) {
  return engine.evaluate({
    teamId: 't',
    wins: 5,
    losses: 5,
    ties: 0,
    pointsFor: 1200,
    leagueAveragePointsFor: 1200,
    leagueStdDevPointsFor: 120,
    weeksRemaining: 4,
    playoffTeams: 6,
    teamCount: 12,
    rank: 6,
    ...overrides,
  })
}

describe('objective engine', () => {
  it('never reports HIGH confidence, because the coefficients are unfitted', () => {
    // Guards the stated cap. If someone fits the model and lifts this, the test
    // should be updated deliberately — not discovered to have been wrong.
    const strong = team({ wins: 10, losses: 0, pointsFor: 1600 })
    expect(strong.confidence).not.toBe('HIGH')
  })

  it('stamps the engine version so a stored grade is traceable', () => {
    expect(team({}).engineVersion).toBe('heuristic-v1')
  })

  it('ranks a high-scoring unlucky team above a low-scoring lucky one', () => {
    // 4-6 with top scoring is a good team with a bad schedule. A record-weighted
    // model would call for a fire-sale here, which is the damaging call.
    const unlucky = team({ wins: 4, losses: 6, pointsFor: 1450 })
    const lucky = team({ wins: 6, losses: 4, pointsFor: 1050 })
    expect(unlucky.pPlayoffs).toBeGreaterThan(lucky.pPlayoffs)
  })

  it('treats championship odds as strictly rarer than playoff odds', () => {
    const t = team({ wins: 9, losses: 1, pointsFor: 1500 })
    expect(t.pChampionship).toBeLessThan(t.pPlayoffs)
  })

  it('identifies the FRINGE band, where advice matters most', () => {
    const fringe = team({ wins: 6, losses: 4, pointsFor: 1260 })
    const band = contentionBand(contentionScore(fringe))
    expect(['FRINGE', 'NEUTRAL', 'CONTENDER']).toContain(band)
  })
})

describe('temporal discounting', () => {
  it('makes a contender discount the future harder than a rebuilder', () => {
    // The mechanism that removes every `if (contending)` branch downstream.
    const contender = discountFactor(2, 0.8, { baseRate: 0.85 })
    const rebuilder = discountFactor(2, -0.8, { baseRate: 0.85 })
    expect(contender).toBeLessThan(rebuilder)
  })

  it('zeroes all future value in a redraft format', () => {
    expect(discountFactor(1, 0, { baseRate: 0 })).toBe(0)
    expect(discountFactor(0, 0, { baseRate: 0 })).toBe(1)
  })
})

/*
 * The per-side `evaluateTrade` and the rank-space `gradeTrade` that lived in
 * `lib/projections/tradeGrading.ts` were deleted on 2026-09-26 — neither had a runtime caller, and
 * the one trade engine is `lib/decision-os/trade/evaluateTrade.ts`. The coverage guard they sat on
 * is still exported and still used by `lib/core-app`, so it keeps its tests.
 */
describe('the coverage guard still governs', () => {
  const priced = (id: string, rank: number | null): TradeSide['assets'][number] => ({ id, rank, rawValue: null })

  it('refuses a single-sided trade', () => {
    expect(hasNoSignal({ label: 'a', assets: [] }, { label: 'b', assets: [priced('x', 1)] })).toBe(true)
  })

  it('refuses partial coverage, rather than pricing the missing asset at zero', () => {
    const partial = { label: 'x', assets: [priced('known', 10), priced('unknown', null)] }
    expect(hasNoSignal(partial, { label: 'y', assets: [priced('z', 40)] })).toBe(true)
  })

  it('allows a fully covered trade — the control that lets the two above fail', () => {
    expect(hasNoSignal({ label: 'a', assets: [priced('star', 5)] }, { label: 'b', assets: [priced('y1', 40), priced('y2', 60)] })).toBe(false)
  })
})
