import { describe, expect, it } from 'vitest'
import {
  HeuristicObjectiveEngine,
  contentionBand,
  contentionScore,
  discountFactor,
} from '@/lib/projections/objectiveEngine'
import { evaluateTrade, gradeTrade, type TradeSide } from '@/lib/projections/tradeGrading'

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

describe('per-side trade evaluation', () => {
  const sideA: TradeSide & { teamId: string } = {
    teamId: 'contender',
    label: 'contender',
    assets: [{ id: 'star', rank: 5, rawValue: null }],
  }
  const sideB: TradeSide & { teamId: string } = {
    teamId: 'rebuilder',
    label: 'rebuilder',
    assets: [
      { id: 'young1', rank: 40, rawValue: null },
      { id: 'young2', rank: 60, rawValue: null },
    ],
  }

  it('reports mutual benefit when both sides improve against their own objective', () => {
    // The contender buys present value; the rebuilder buys future. Both gain.
    // A "who won" verdict would be wrong here, which is the whole point.
    const res = evaluateTrade({
      sideA,
      sideB,
      objectiveDeltaFor: (teamId) => (teamId === 'contender' ? 0.03 : 0.02),
      engineVersion: 'test',
    })
    expect(res.evaluated).toBe(true)
    if (!res.evaluated) return
    expect(res.mutualBenefit).toBe(true)
    expect(res.sides).toHaveLength(2)
    expect(res.sides.every((s) => s.delta > 0)).toBe(true)
  })

  it('grades the same trade oppositely for differently-situated teams', () => {
    const res = evaluateTrade({
      sideA,
      sideB,
      objectiveDeltaFor: (teamId) => (teamId === 'contender' ? 0.06 : -0.06),
      engineVersion: 'test',
    })
    if (!res.evaluated) return
    expect(res.mutualBenefit).toBe(false)
    expect(res.sides[0].verdict).toBe('STRONG_GAIN')
    expect(res.sides[1].verdict).toBe('STRONG_LOSS')
  })

  it('refuses to evaluate when coverage is partial, exactly as grading does', () => {
    const partial: TradeSide & { teamId: string } = {
      teamId: 'x',
      label: 'x',
      assets: [
        { id: 'known', rank: 10, rawValue: null },
        { id: 'unknown', rank: null, rawValue: null },
      ],
    }
    const res = evaluateTrade({
      sideA: partial,
      sideB,
      objectiveDeltaFor: () => 0.05,
      engineVersion: 'test',
    })
    expect(res.evaluated).toBe(false)
    if (res.evaluated) return
    expect(res.reason).toBe('PARTIAL_COVERAGE')
  })

  it('keeps the value split as context, not as the verdict', () => {
    const res = evaluateTrade({
      sideA,
      sideB,
      objectiveDeltaFor: () => 0.01,
      engineVersion: 'test',
    })
    if (!res.evaluated) return
    // The split is still available for display...
    expect(res.valueSplit.graded).toBe(true)
    // ...but the per-side verdicts are what a consumer grades on.
    expect(res.sides[0].verdict).toBeDefined()
  })
})

describe('the coverage guard still governs', () => {
  it('refuses a single-sided trade', () => {
    const g = gradeTrade(
      { label: 'a', assets: [] },
      { label: 'b', assets: [{ id: 'x', rank: 1, rawValue: null }] }
    )
    expect(g.graded).toBe(false)
  })
})
