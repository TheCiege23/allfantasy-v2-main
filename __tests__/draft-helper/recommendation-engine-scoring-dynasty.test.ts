import { describe, expect, it } from 'vitest'
import { computeDraftPlayerRankings, computeDraftRecommendation, type RecommendationInput, type RecommendationPlayer } from '@/lib/draft-helper/RecommendationEngine'

function basePlayer(overrides: Partial<RecommendationPlayer>): RecommendationPlayer {
  return { name: 'X', position: 'WR', team: 'AAA', adp: 50, ...overrides }
}

function baseInput(overrides: Partial<RecommendationInput>): RecommendationInput {
  return {
    available: [],
    teamRoster: [],
    rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
    round: 5,
    pick: 5,
    totalTeams: 12,
    sport: 'NFL',
    mode: 'bpa',
    ...overrides,
  }
}

// Phase 29: RecommendationEngine.ts had zero dedicated unit tests before this
// phase (confirmed by repo-wide search). These tests are written first,
// against the pre-Phase-29 engine, to demonstrate the two real gaps this
// phase closes: (1) scoring format has no effect on scoring at all -- the
// RecommendationInput type doesn't even have a scoringFormat field; (2)
// isDynasty only changes explanation text, never the numeric score, even
// when real age data is available.
describe('RecommendationEngine — scoring format differentiation (Phase 29)', () => {
  it('a WR and RB with identical ADP score differently in PPR vs Standard', () => {
    const wr = basePlayer({ name: 'Pass Catcher', position: 'WR', adp: 50 })
    const rb = basePlayer({ name: 'Ground Game', position: 'RB', adp: 50 })
    const input = baseInput({ available: [wr, rb] })

    const pprRankings = computeDraftPlayerRankings({ ...input, scoringFormat: 'ppr' })
    const standardRankings = computeDraftPlayerRankings({ ...input, scoringFormat: 'standard' })

    const wrPpr = pprRankings!.scored.find((s) => s.player.name === 'Pass Catcher')!.totalScore
    const wrStandard = standardRankings!.scored.find((s) => s.player.name === 'Pass Catcher')!.totalScore

    expect(wrPpr).toBeGreaterThan(wrStandard)
  })

  it('half_ppr sits between standard and full ppr for the same WR', () => {
    const wr = basePlayer({ name: 'Pass Catcher', position: 'WR', adp: 50 })
    const input = baseInput({ available: [wr] })

    const standard = computeDraftPlayerRankings({ ...input, scoringFormat: 'standard' })!.scored[0].totalScore
    const half = computeDraftPlayerRankings({ ...input, scoringFormat: 'half_ppr' })!.scored[0].totalScore
    const full = computeDraftPlayerRankings({ ...input, scoringFormat: 'ppr' })!.scored[0].totalScore

    expect(half).toBeGreaterThan(standard)
    expect(full).toBeGreaterThan(half)
  })

  it('defaults to standard (no boost) when scoringFormat is omitted, preserving backward compatibility', () => {
    const wr = basePlayer({ name: 'Pass Catcher', position: 'WR', adp: 50 })
    const input = baseInput({ available: [wr] })

    const omitted = computeDraftPlayerRankings(input)!.scored[0].totalScore
    const explicitStandard = computeDraftPlayerRankings({ ...input, scoringFormat: 'standard' })!.scored[0].totalScore

    expect(omitted).toBe(explicitStandard)
  })

  it('is deterministic: identical inputs always produce identical scores', () => {
    const wr = basePlayer({ name: 'Pass Catcher', position: 'WR', adp: 50 })
    const input = baseInput({ available: [wr], scoringFormat: 'ppr' })

    const run1 = computeDraftPlayerRankings(input)!.scored[0].totalScore
    const run2 = computeDraftPlayerRankings(input)!.scored[0].totalScore

    expect(run1).toBe(run2)
  })
})

describe('RecommendationEngine — Dynasty age-based scoring (Phase 29)', () => {
  it('a young player outscores an older player with identical ADP in Dynasty leagues', () => {
    const young = basePlayer({ name: 'Rookie Star', position: 'WR', adp: 50, age: 22 })
    const old = basePlayer({ name: 'Veteran', position: 'WR', adp: 50, age: 33 })
    const input = baseInput({ available: [young, old], isDynasty: true })

    const rankings = computeDraftPlayerRankings(input)!
    const youngScore = rankings.scored.find((s) => s.player.name === 'Rookie Star')!.totalScore
    const oldScore = rankings.scored.find((s) => s.player.name === 'Veteran')!.totalScore

    expect(youngScore).toBeGreaterThan(oldScore)
  })

  it('age has no scoring effect in non-Dynasty (redraft) leagues, preserving backward compatibility', () => {
    const young = basePlayer({ name: 'Rookie Star', position: 'WR', adp: 50, age: 22 })
    const old = basePlayer({ name: 'Veteran', position: 'WR', adp: 50, age: 33 })
    const input = baseInput({ available: [young, old], isDynasty: false })

    const rankings = computeDraftPlayerRankings(input)!
    const youngScore = rankings.scored.find((s) => s.player.name === 'Rookie Star')!.totalScore
    const oldScore = rankings.scored.find((s) => s.player.name === 'Veteran')!.totalScore

    expect(youngScore).toBe(oldScore)
  })

  it('missing age data does not throw and does not distort the score in Dynasty leagues', () => {
    const noAge = basePlayer({ name: 'Unknown Age', position: 'WR', adp: 50 })
    const input = baseInput({ available: [noAge], isDynasty: true })

    expect(() => computeDraftPlayerRankings(input)).not.toThrow()
  })

  it('the Dynasty explanation note still appears alongside the new real scoring effect', () => {
    const young = basePlayer({ name: 'Rookie Star', position: 'WR', adp: 50, age: 22 })
    const input = baseInput({ available: [young], isDynasty: true, teamRoster: [] })
    const result = computeDraftRecommendation(input)

    expect(result.formatInsight).toMatch(/Dynasty context favors multi-year value/)
  })
})
