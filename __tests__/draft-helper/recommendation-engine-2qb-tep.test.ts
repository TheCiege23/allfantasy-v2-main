import { describe, expect, it } from 'vitest'
import { computeDraftPlayerRankings, type RecommendationInput, type RecommendationPlayer } from '@/lib/draft-helper/RecommendationEngine'

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

// Phase 31: real finding -- 2QB and Superflex are structurally distinguishable in real league
// data (SUPER_FLEX/OP starter slot vs two dedicated QB slots), and every real fantasy-football
// mechanic differs between them: a 2QB roster MUST start two QBs, a Superflex roster only MAY.
// This engine previously had no is2QB concept at all -- only isSF (Superflex).
describe('RecommendationEngine — 2QB vs Superflex distinct QB boosts (Phase 31)', () => {
  it('a 2QB league boosts a QB players score more than an equivalent Superflex league', () => {
    const qb = basePlayer({ name: 'Elite QB', position: 'QB', adp: 40 })
    const input = baseInput({ available: [qb] })

    const sfScore = computeDraftPlayerRankings({ ...input, isSF: true })!.scored[0].totalScore
    const twoQbScore = computeDraftPlayerRankings({ ...input, is2QB: true })!.scored[0].totalScore

    expect(twoQbScore).toBeGreaterThan(sfScore)
  })

  it('a non-QB player is unaffected by either isSF or is2QB', () => {
    const wr = basePlayer({ name: 'Elite WR', position: 'WR', adp: 40 })
    const input = baseInput({ available: [wr] })

    const base = computeDraftPlayerRankings(input)!.scored[0].totalScore
    const withSF = computeDraftPlayerRankings({ ...input, isSF: true })!.scored[0].totalScore
    const with2QB = computeDraftPlayerRankings({ ...input, is2QB: true })!.scored[0].totalScore

    expect(withSF).toBe(base)
    expect(with2QB).toBe(base)
  })

  it('omitting is2QB preserves exact pre-Phase-31 behavior (backward compatible)', () => {
    const qb = basePlayer({ name: 'Elite QB', position: 'QB', adp: 40 })
    const input = baseInput({ available: [qb], isSF: true })

    const omitted = computeDraftPlayerRankings(input)!.scored[0].totalScore
    const explicitFalse = computeDraftPlayerRankings({ ...input, is2QB: false })!.scored[0].totalScore

    expect(omitted).toBe(explicitFalse)
  })

  it('is deterministic: identical is2QB context always produces identical scores', () => {
    const qb = basePlayer({ name: 'Elite QB', position: 'QB', adp: 40 })
    const input = baseInput({ available: [qb], is2QB: true })

    expect(computeDraftPlayerRankings(input)!.scored[0].totalScore).toBe(
      computeDraftPlayerRankings(input)!.scored[0].totalScore
    )
  })
})

// Phase 31: real finding -- the prior TE handling was a roster-slot-presence approximation
// (`rosterSlots.includes('TE')`), which fires for nearly every real NFL league regardless of
// its actual scoring rules, so it was never a genuine TE Premium signal. Replaced with a real
// settings.te_premium/tePremium read (same field name pattern already used by
// lib/agents/anthropic-pipeline.ts's buildLeagueScoringSettings for AI chat context).
describe('RecommendationEngine — real TE Premium scoring (Phase 31)', () => {
  it('a TE scores higher when tePremiumValue is a real positive number', () => {
    const te = basePlayer({ name: 'Elite TE', position: 'TE', adp: 40 })
    const input = baseInput({ available: [te] })

    const noTep = computeDraftPlayerRankings(input)!.scored[0].totalScore
    const withTep = computeDraftPlayerRankings({ ...input, tePremiumValue: 1 })!.scored[0].totalScore

    expect(withTep).toBeGreaterThan(noTep)
  })

  it('a non-TE player is unaffected by tePremiumValue', () => {
    const rb = basePlayer({ name: 'Elite RB', position: 'RB', adp: 40 })
    const input = baseInput({ available: [rb] })

    const noTep = computeDraftPlayerRankings(input)!.scored[0].totalScore
    const withTep = computeDraftPlayerRankings({ ...input, tePremiumValue: 1 })!.scored[0].totalScore

    expect(withTep).toBe(noTep)
  })

  it('omitting tePremiumValue (the real, honest state for all 65 leagues in .env.test) preserves the TE baseline with zero blanket boost', () => {
    const te = basePlayer({ name: 'Baseline TE', position: 'TE', adp: 40 })
    const input = baseInput({ available: [te] })

    const omitted = computeDraftPlayerRankings(input)!.scored[0].totalScore
    const explicitNull = computeDraftPlayerRankings({ ...input, tePremiumValue: null })!.scored[0].totalScore

    expect(omitted).toBe(explicitNull)
  })

  it('a tePremiumValue of 0 applies no boost', () => {
    const te = basePlayer({ name: 'Zero TEP TE', position: 'TE', adp: 40 })
    const input = baseInput({ available: [te] })

    const noTep = computeDraftPlayerRankings(input)!.scored[0].totalScore
    const zeroTep = computeDraftPlayerRankings({ ...input, tePremiumValue: 0 })!.scored[0].totalScore

    expect(zeroTep).toBe(noTep)
  })

  it('is deterministic: identical tePremiumValue always produces identical scores', () => {
    const te = basePlayer({ name: 'Elite TE', position: 'TE', adp: 40 })
    const input = baseInput({ available: [te], tePremiumValue: 0.5 })

    expect(computeDraftPlayerRankings(input)!.scored[0].totalScore).toBe(
      computeDraftPlayerRankings(input)!.scored[0].totalScore
    )
  })
})
