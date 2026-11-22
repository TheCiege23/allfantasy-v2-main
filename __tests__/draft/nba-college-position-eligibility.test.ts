import { describe, expect, it } from 'vitest'
import { draftPoolRowMatchesEligiblePositions, filterEntriesByDraftEligiblePositions } from '@/lib/draft-room/draft-pool-eligible-positions'
describe('college basketball draft positions', () => {
  it('matches broad basketball positions to the corresponding pro slots', () => {
    expect(draftPoolRowMatchesEligiblePositions('G', new Set(['PG']), 'NBA')).toBe(true)
    expect(draftPoolRowMatchesEligiblePositions('F', new Set(['PF']), 'NBA')).toBe(true)
    expect(draftPoolRowMatchesEligiblePositions('G', new Set(['PF']), 'NBA')).toBe(false)
    expect(filterEntriesByDraftEligiblePositions([{ position: 'G' }, { position: 'F' }], new Set(['SG']), 'NBA')).toEqual([{ position: 'G' }])
  })
  it('does not treat a hockey goalie or football position as a basketball guard', () => {
    expect(draftPoolRowMatchesEligiblePositions('G', new Set(['PG']), 'NHL')).toBe(false)
    expect(draftPoolRowMatchesEligiblePositions('G', new Set(['PG']), 'NFL')).toBe(false)
  })
})
