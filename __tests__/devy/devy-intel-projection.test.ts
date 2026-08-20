import { describe, expect, it } from 'vitest'

import {
  computeAllDevyIntelMetrics,
  computeDevyProjection,
  computeRecruitingCompositeOrNull,
  estimateProjectedDraftRoundOrNull,
  hasProductionEvidence,
  hasRecruitingEvidence,
} from '@/lib/devy-intel'

/** Minimal shape the intel model reads; extra fields are ignored. */
const base = (over: Record<string, unknown> = {}) =>
  ({
    position: 'WR',
    classYear: 2,
    draftEligibleYear: 2028,
    ...over,
  }) as never

describe('evidence detection', () => {
  it('recognises any of composite, stars or ranking as recruiting evidence', () => {
    expect(hasRecruitingEvidence(base({ recruitingComposite: 0.9 }))).toBe(true)
    expect(hasRecruitingEvidence(base({ recruitingStars: 4 }))).toBe(true)
    expect(hasRecruitingEvidence(base({ recruitingRanking: 120 }))).toBe(true)
    expect(hasRecruitingEvidence(base())).toBe(false)
    // Zero is absence, not a rating of zero.
    expect(hasRecruitingEvidence(base({ recruitingComposite: 0, recruitingStars: 0 }))).toBe(false)
  })

  it('recognises any real stat line as production evidence', () => {
    expect(hasProductionEvidence(base({ receivingYards: 800 }))).toBe(true)
    expect(hasProductionEvidence(base({ passingTDs: 12 }))).toBe(true)
    expect(hasProductionEvidence(base({ receivingYards: 0, receptions: 0 }))).toBe(false)
    expect(hasProductionEvidence(base())).toBe(false)
  })
})

describe('no fabrication when nothing backs a value', () => {
  it('returns a null composite instead of the bare 0.75 default', () => {
    // computeRecruitingComposite falls through to `return 0.75`; this must not.
    expect(computeRecruitingCompositeOrNull(base())).toBeNull()
    expect(computeRecruitingCompositeOrNull(base({ recruitingStars: 5 }))).toBeCloseTo(0.98, 5)
  })

  it('returns a null projected round instead of always producing one', () => {
    // estimateProjectedDraftRound has no null path — its floor is round 7.
    expect(estimateProjectedDraftRoundOrNull(base())).toBeNull()
    expect(estimateProjectedDraftRoundOrNull(base({ recruitingComposite: 0.99 }))).toBeGreaterThan(0)
  })

  it('leaves the persisted metrics null rather than filled in', () => {
    const m = computeAllDevyIntelMetrics(base()) as never as {
      recruitingComposite: number | null
      projectedDraftRound: number | null
      projectedDraftPick: number | null
      draftProjectionScore: number | null
    }
    expect(m.recruitingComposite).toBeNull()
    expect(m.projectedDraftRound).toBeNull()
    expect(m.projectedDraftPick).toBeNull()
    expect(m.draftProjectionScore).toBeNull()
  })
})

describe('a score requires substantive evidence', () => {
  it('refuses to score a player known only by height and weight', () => {
    // Real data, but not an evaluation — a number here would anchor with
    // nothing scouting-related behind it.
    const p = computeDevyProjection(base({ heightInches: 74, weightLbs: 205 }))
    expect(p.score).toBeNull()
    expect(p.confidence).toBeNull()
  })

  it('scores on recruiting alone, at low coverage', () => {
    const p = computeDevyProjection(base({ recruitingComposite: 0.95 }))
    expect(p.score).not.toBeNull()
    expect(p.present).toContain('recruiting')
    // recruiting .20 + draftCapital .15 (derivable from it) = .35
    expect(p.coverage).toBeCloseTo(0.35, 3)
    expect(p.confidence).toBe('low')
  })

  it('raises coverage and confidence as real signals accumulate', () => {
    const p = computeDevyProjection(
      base({
        recruitingComposite: 0.95,
        receivingYards: 900,
        receivingTDs: 8,
        receptions: 60,
        statSeason: 2025,
        heightInches: 74,
        weightLbs: 205,
        ppaTotal: 0.35,
        wepaTotal: 40,
        teamSpRating: 20,
      }),
    )
    expect(p.coverage).toBeGreaterThan(0.7)
    expect(p.confidence).toBe('high')
    expect(p.missing).not.toContain('production')
  })

  it('names exactly which signals were absent', () => {
    const p = computeDevyProjection(base({ recruitingComposite: 0.9 }))
    expect(p.missing).toContain('ppa')
    expect(p.missing).toContain('wepa')
    expect(p.missing).toContain('teamContext')
    expect(p.missing).not.toContain('recruiting')
  })
})

describe('transfer risk is a known-status penalty, not a signal', () => {
  it('does not count toward coverage', () => {
    const without = computeDevyProjection(base({ recruitingComposite: 0.9 }))
    const with_ = computeDevyProjection(base({ recruitingComposite: 0.9, transferStatus: true }))
    expect(with_.coverage).toBe(without.coverage)
  })

  it('only lowers the score when the status is actually recorded', () => {
    const without = computeDevyProjection(base({ recruitingComposite: 0.9 }))
    const with_ = computeDevyProjection(base({ recruitingComposite: 0.9, transferStatus: true }))
    expect(with_.score!).toBeLessThan(without.score!)
  })
})
