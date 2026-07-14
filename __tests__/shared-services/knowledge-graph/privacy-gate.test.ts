import { describe, expect, it } from 'vitest'
import { checkPrivacyGate, MINIMUM_COHORT_LEAGUES } from '@/lib/shared-services/knowledge-graph/PrivacyGate'

describe('checkPrivacyGate', () => {
  it('denies when the cohort is below the minimum threshold', () => {
    const result = checkPrivacyGate(5)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/insufficient cohort/i)
    expect(result.cohortSize).toBe(5)
    expect(result.threshold).toBe(MINIMUM_COHORT_LEAGUES)
  })

  it('allows exactly at the threshold', () => {
    const result = checkPrivacyGate(MINIMUM_COHORT_LEAGUES)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeNull()
  })

  it('allows above the threshold', () => {
    const result = checkPrivacyGate(MINIMUM_COHORT_LEAGUES + 100)
    expect(result.allowed).toBe(true)
  })

  it('denies at zero cohort', () => {
    const result = checkPrivacyGate(0)
    expect(result.allowed).toBe(false)
    expect(result.cohortSize).toBe(0)
  })

  it('supports a custom threshold override', () => {
    const result = checkPrivacyGate(3, 3)
    expect(result.allowed).toBe(true)
    expect(result.threshold).toBe(3)
  })
})
