import { describe, expect, it } from 'vitest'

import { computeDraftProjection, computeDraftProjectionScore } from '@/lib/devy-model'
import { computeClassDepthByPosition, computeClassStrength } from '@/lib/pick-valuation'

describe('a player we know nothing about', () => {
  it('scores null, not a number', () => {
    // Previously every absent input defaulted to 50, so an empty player scored
    // 33/100 — a confident figure manufactured from nothing.
    const projection = computeDraftProjection({})
    expect(projection.score).toBeNull()
    expect(projection.confidence).toBeNull()
    expect(computeDraftProjectionScore({})).toBeNull()
  })

  it('names every signal it lacked rather than silently substituting', () => {
    const projection = computeDraftProjection({})
    expect(projection.present).toEqual([])
    expect(projection.missing).toEqual([
      'recruitingComposite',
      'breakoutAge',
      'projectedDraftRound',
      'devyAdp',
    ])
  })

  it('treats zero and non-finite inputs as absent, not as real values', () => {
    expect(computeDraftProjectionScore({ recruitingComposite: 0 })).toBeNull()
    expect(computeDraftProjectionScore({ devyAdp: Number.NaN })).toBeNull()
  })
})

describe('scoring on what is actually known', () => {
  it('does not dilute a strong lone signal toward average', () => {
    // A 5-star with no other data. Under the old model three phantom 50s
    // dragged him to 57; he is now scored on the signal that exists.
    const projection = computeDraftProjection({ recruitingComposite: 0.99 })
    expect(projection.score).toBe(99)
    expect(projection.present).toEqual(['recruitingComposite'])
    // One of four signals is thin, and the confidence says so.
    expect(projection.confidence).toBe('low')
  })

  it('accepts a composite already expressed 0-100', () => {
    expect(computeDraftProjection({ recruitingComposite: 99 }).score).toBe(99)
  })

  it('raises confidence as coverage grows', () => {
    const two = computeDraftProjection({ recruitingComposite: 0.9, projectedDraftRound: 1 })
    expect(two.confidence).toBe('moderate')

    const all = computeDraftProjection({
      recruitingComposite: 0.9,
      breakoutAge: 19,
      projectedDraftRound: 1,
      devyAdp: 2,
    })
    expect(all.confidence).toBe('high')
    expect(all.missing).toEqual([])
  })

  it('blends present signals by their relative weight', () => {
    // recruiting 90 (w .25) and draft capital 95 (w .30) -> (22.5+28.5)/.55
    const projection = computeDraftProjection({ recruitingComposite: 0.9, projectedDraftRound: 1 })
    expect(projection.score).toBe(93)
  })

  it('applies modifiers only when supplied, without counting as signal', () => {
    const base = computeDraftProjection({ recruitingComposite: 0.8 })
    const injured = computeDraftProjection({ recruitingComposite: 0.8, injurySeverityScore: 80 })
    expect(base.score).toBe(80)
    expect(injured.score).toBe(76)
    // Confidence reflects signal coverage, which an injury flag does not change.
    expect(injured.confidence).toBe(base.confidence)
  })
})

describe('class aggregates exclude unscored players', () => {
  it('does not let unknown prospects vote "average" on class strength', () => {
    const scored = computeClassStrength([
      { projectedDraftRound: 1, draftProjectionScore: 90 },
      { projectedDraftRound: 1, draftProjectionScore: 80 },
    ])
    const withUnknowns = computeClassStrength([
      { projectedDraftRound: 1, draftProjectionScore: 90 },
      { projectedDraftRound: 1, draftProjectionScore: 80 },
      { projectedDraftRound: 1, draftProjectionScore: null },
      { projectedDraftRound: 1, draftProjectionScore: null },
    ])
    // Under the old `?? 50` the unknowns would have dragged 85 down to ~68.
    expect(scored).toBe(85)
    expect(withUnknowns).toBe(85)
  })

  it('falls back only when nothing at all is scored', () => {
    expect(computeClassStrength([{ projectedDraftRound: 1, draftProjectionScore: null }])).toBe(50)
    expect(computeClassStrength([])).toBe(50)
  })

  it('keeps positional depth free of phantom scores', () => {
    const depth = computeClassDepthByPosition([
      { position: 'QB', draftProjectionScore: 95 },
      { position: 'QB', draftProjectionScore: null },
      { position: 'RB', draftProjectionScore: null },
    ])
    expect(depth.qbDepth).toBe(95)
    // No RB was scored, so RB depth reports the empty fallback, not 50.
    expect(depth.rbDepth).toBe(40)
  })
})
