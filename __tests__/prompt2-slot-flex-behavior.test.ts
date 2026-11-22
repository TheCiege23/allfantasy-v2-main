import { describe, expect, it } from 'vitest'
import {
  getAllowedPositionsForSlot,
  isPositionEligibleForSlot,
} from '@/lib/roster-defaults/PositionEligibilityResolver'

describe('Prompt 2 slot/flex behavior by sport', () => {
  it('NBA: G/F/UTIL flex slots enforce expected guard-forward-center behavior', () => {
    expect(getAllowedPositionsForSlot('NBA', 'G')).toEqual(expect.arrayContaining(['PG', 'SG']))
    expect(getAllowedPositionsForSlot('NBA', 'F')).toEqual(expect.arrayContaining(['SF', 'PF']))
    expect(getAllowedPositionsForSlot('NBA', 'UTIL')).toEqual(
      expect.arrayContaining(['PG', 'SG', 'SF', 'PF', 'C'])
    )

    expect(isPositionEligibleForSlot('NBA', 'G', 'PG')).toBe(true)
    expect(isPositionEligibleForSlot('NBA', 'G', 'C')).toBe(false)
  })

  it('MLB: pitcher/utility slots respect SP/RP and hitter pool rules', () => {
    expect(getAllowedPositionsForSlot('MLB', 'P')).toEqual(expect.arrayContaining(['SP', 'RP']))
    expect(getAllowedPositionsForSlot('MLB', 'UTIL')).toEqual(
      expect.arrayContaining(['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'])
    )

    expect(isPositionEligibleForSlot('MLB', 'P', 'SP')).toBe(true)
    expect(isPositionEligibleForSlot('MLB', 'UTIL', 'SP')).toBe(false)
  })

  it('NHL: UTIL accepts skaters but excludes goalies', () => {
    expect(getAllowedPositionsForSlot('NHL', 'UTIL')).toEqual(
      expect.arrayContaining(['C', 'LW', 'RW', 'D'])
    )

    expect(isPositionEligibleForSlot('NHL', 'UTIL', 'LW')).toBe(true)
    expect(isPositionEligibleForSlot('NHL', 'UTIL', 'G')).toBe(false)
  })

  it('NCAAF: FLEX enforces college football eligibility boundaries; SUPERFLEX is opt-in', () => {
    expect(getAllowedPositionsForSlot('NCAAF', 'FLEX')).toEqual(
      expect.arrayContaining(['RB', 'WR', 'TE'])
    )
    expect(isPositionEligibleForSlot('NCAAF', 'FLEX', 'QB')).toBe(false)
    expect(isPositionEligibleForSlot('NCAAF', 'FLEX', 'RB')).toBe(true)

    // The default NCAAF template has carried no SUPERFLEX starter since 595959f64 (a commissioner adds
    // one), so the default template offers no superflex slot to place a QB in.
    expect(getAllowedPositionsForSlot('NCAAF', 'SUPERFLEX')).toEqual([])
  })

  it('NCAAB: UTIL accepts G/F/C while primary slots reject mismatched positions', () => {
    expect(getAllowedPositionsForSlot('NCAAB', 'UTIL')).toEqual(
      expect.arrayContaining(['G', 'F', 'C'])
    )

    expect(isPositionEligibleForSlot('NCAAB', 'UTIL', 'C')).toBe(true)
    expect(isPositionEligibleForSlot('NCAAB', 'F', 'C')).toBe(false)
  })
})