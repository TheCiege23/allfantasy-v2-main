import { describe, expect, it } from 'vitest'
import {
  TIER_WEIGHT,
  coachingFactorUnavailable,
  compositeConfidence,
  excludedFactor,
  includedFactor,
  sampleConfidence,
  summariseFactors,
  totalFactorPoints,
} from '@/lib/projections/factorContract'

/**
 * These tests exist because the failure they guard against is INVISIBLE in output.
 * A factor silently imputed to a league-average default produces a plausible
 * number, passes review, and misleads a user who has no way to know it happened.
 */
describe('projection factor contract', () => {
  describe('INSUFFICIENT applies exactly zero weight', () => {
    // The single assertion the build spec's checklist calls for by name.
    it('has a zero weight in the tier table', () => {
      expect(TIER_WEIGHT.INSUFFICIENT).toBe(0)
    })

    it('degrades an INSUFFICIENT inclusion to an exclusion, contributing nothing', () => {
      const f = includedFactor({
        factor: 'opponent_history',
        confidence: 'INSUFFICIENT',
        // A large raw effect, deliberately — if any default sneaks in, this leaks
        // 40 points into the projection and the test fails loudly.
        rawPoints: 40,
        sampleSize: 1,
        detail: 'one game',
      })
      expect(f.included).toBe(false)
      expect(f.points).toBe(0)
      expect(f.weightApplied).toBe(0)
      expect(f.reason).toBe('INSUFFICIENT_SAMPLE')
      expect(f.confidence).toBeNull()
    })

    it('never lets an excluded factor carry points into the total', () => {
      const total = totalFactorPoints([
        excludedFactor('coaching', 'NO_DATA_SOURCE', 'no source'),
        includedFactor({
          factor: 'weather',
          confidence: 'HIGH',
          rawPoints: 2,
          sampleSize: null,
          detail: 'wind',
        }),
        includedFactor({
          factor: 'opponent_history',
          confidence: 'INSUFFICIENT',
          rawPoints: 99,
          sampleSize: 1,
          detail: 'n=1',
        }),
      ])
      // Only the weather factor may contribute.
      expect(total).toBe(2)
    })
  })

  describe('an excluded factor is distinguishable from a neutral one', () => {
    it('reports null confidence rather than LOW', () => {
      const f = excludedFactor('coaching', 'NO_DATA_SOURCE', 'nothing ingested')
      // LOW would read as "we looked and found little"; null is "we did not look".
      expect(f.confidence).toBeNull()
      expect(f.included).toBe(false)
    })

    it('reports coaching as explicitly unavailable rather than omitting it', () => {
      const f = coachingFactorUnavailable()
      expect(f.factor).toBe('coaching')
      expect(f.included).toBe(false)
      expect(f.reason).toBe('NO_DATA_SOURCE')
      expect(f.points).toBe(0)
      expect(f.detail).toContain('not part of this projection')
    })
  })

  describe('composite confidence is the minimum, never the average', () => {
    it('lets one unresolved axis govern an otherwise strong profile', () => {
      // Impeccable sourcing, huge sample, unknown play-caller. Averaging would
      // call this MEDIUM; it is LOW, because it may describe the wrong person.
      expect(compositeConfidence(['HIGH', 'HIGH', 'LOW'])).toBe('LOW')
    })

    it('collapses to INSUFFICIENT when any axis is insufficient', () => {
      expect(compositeConfidence(['HIGH', 'HIGH', 'INSUFFICIENT'])).toBe('INSUFFICIENT')
    })

    it('treats an empty axis list as insufficient, not as high', () => {
      expect(compositeConfidence([])).toBe('INSUFFICIENT')
    })
  })

  describe('weighting', () => {
    it('halves a MEDIUM factor and quarters a LOW one', () => {
      const med = includedFactor({
        factor: 'x',
        confidence: 'MEDIUM',
        rawPoints: 4,
        sampleSize: 5,
        detail: '',
      })
      const low = includedFactor({
        factor: 'y',
        confidence: 'LOW',
        rawPoints: 4,
        sampleSize: 2,
        detail: '',
      })
      expect(med.points).toBe(2)
      expect(low.points).toBe(1)
      // The undamped value stays visible so a UI can show what was reduced.
      expect(med.rawPoints).toBe(4)
    })
  })

  describe('sample confidence scales', () => {
    it('does not let a play-level count inherit a game-level tier', () => {
      // 300 is a healthy game count but a thin play count. Conflating the two
      // is how a weak field launders itself into a strong one.
      expect(sampleConfidence(300, 'games')).toBe('HIGH')
      expect(sampleConfidence(300, 'plays')).toBe('LOW')
    })

    it('treats zero as insufficient on both scales', () => {
      expect(sampleConfidence(0, 'games')).toBe('INSUFFICIENT')
      expect(sampleConfidence(0, 'plays')).toBe('INSUFFICIENT')
    })
  })

  describe('summary for display', () => {
    it('names every excluded factor with its reason', () => {
      const s = summariseFactors([
        coachingFactorUnavailable(),
        includedFactor({
          factor: 'weather',
          confidence: 'HIGH',
          rawPoints: 1.5,
          sampleSize: null,
          detail: '',
        }),
      ])
      expect(s.included).toEqual(['weather'])
      expect(s.excluded).toEqual([{ factor: 'coaching', reason: 'NO_DATA_SOURCE' }])
      expect(s.totalPoints).toBe(1.5)
    })
  })
})
