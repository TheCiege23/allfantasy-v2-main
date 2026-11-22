import { describe, expect, it } from 'vitest'
import { isRevivedSurvivor } from '@/lib/zombie/weeklyUpdateSurvivors'

describe('weekly update revived survivors', () => {
  it('recognizes a survivor whose revival is recorded on the team', () => {
    expect(isRevivedSurvivor({ status: 'Survivor', revivedAt: new Date('2026-10-01T00:00:00Z') })).toBe(true)
    expect(isRevivedSurvivor({ status: 'Survivor', revivedAt: null })).toBe(false)
  })
  it('does not list a manager who has since turned back into a Zombie', () => {
    expect(isRevivedSurvivor({ status: 'Zombie', revivedAt: new Date('2026-10-01T00:00:00Z') })).toBe(false)
    expect(isRevivedSurvivor({ status: 'Revived', revivedAt: null })).toBe(true)
  })
})
