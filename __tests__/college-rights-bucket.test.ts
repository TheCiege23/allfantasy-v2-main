import { describe, expect, it } from 'vitest'
import {
  buildCollegeRightsViewModel,
  collegeRightsStateLabel,
} from '@/lib/devy/collegeRightsBucket'

const rights = [
  { id: 'r1', devyPlayerId: 'p1', state: 'NCAA_DEVY_ACTIVE', seasonYear: 2026 },
  { id: 'r2', devyPlayerId: 'p-missing', state: 'SOME_FUTURE_STATE', seasonYear: null },
]
const players = [{ id: 'p1', name: 'Test Prospect', position: 'QB', school: 'Test State' }]

describe('buildCollegeRightsViewModel', () => {
  it('maps rights joined to DevyPlayer into the view model with the fixed honesty labels', () => {
    const vm = buildCollegeRightsViewModel(rights, players)
    expect(vm).not.toBeNull()
    expect(vm?.heading).toBe('College rights')
    expect(vm?.scoringNote).toBe('No in-season scoring yet')
    expect(vm?.entries).toHaveLength(2)
    const first = vm?.entries[0]
    expect(first?.rightsId).toBe('r1')
    expect(first?.player).toEqual({ name: 'Test Prospect', position: 'QB', school: 'Test State' })
    expect(first?.state).toBe('NCAA_DEVY_ACTIVE')
    expect(first?.stateLabel).toBe('Active (college)')
    expect(first?.seasonYear).toBe(2026)
  })

  it('keeps a rights row whose player record is missing as a labeled absence, never an invented name', () => {
    const vm = buildCollegeRightsViewModel(rights, players)
    const second = vm?.entries[1]
    expect(second?.player).toBeNull()
    expect(second?.rightsId).toBe('r2')
    // Unknown lifecycle states render verbatim rather than being remapped to something that looks known.
    expect(second?.stateLabel).toBe('SOME_FUTURE_STATE')
  })

  it('returns null for zero rows so the section is absent entirely', () => {
    expect(buildCollegeRightsViewModel([], players)).toBeNull()
  })
})

describe('collegeRightsStateLabel', () => {
  it('labels known lifecycle states', () => {
    expect(collegeRightsStateLabel('PROMOTION_ELIGIBLE')).toBe('Promotion eligible')
    expect(collegeRightsStateLabel('DRAFTED_RIGHTS_HELD')).toBe('Drafted (rights held)')
    expect(collegeRightsStateLabel('RETURNED_TO_SCHOOL')).toBe('Returned to school')
  })

  it('passes unknown states through verbatim', () => {
    expect(collegeRightsStateLabel('WHO_KNOWS')).toBe('WHO_KNOWS')
  })
})
