import { describe, expect, it } from 'vitest'
import {
  getAllowedPositionsForSlot,
  isPositionEligibleForSlot,
} from '@/lib/roster-defaults/PositionEligibilityResolver'
import { canAddPlayerToSlot, validateRoster } from '@/lib/roster-defaults/RosterValidationEngine'

describe('Prompt 2 slot/flex behavior by sport', () => {
  it('NBA: G/F/UTIL flex slots enforce expected guard-forward-center behavior', () => {
    expect(getAllowedPositionsForSlot('NBA', 'G')).toEqual(expect.arrayContaining(['PG', 'SG']))
    expect(getAllowedPositionsForSlot('NBA', 'F')).toEqual(expect.arrayContaining(['SF', 'PF']))
    expect(getAllowedPositionsForSlot('NBA', 'UTIL')).toEqual(
      expect.arrayContaining(['PG', 'SG', 'SF', 'PF', 'C'])
    )

    expect(isPositionEligibleForSlot('NBA', 'G', 'PG')).toBe(true)
    expect(isPositionEligibleForSlot('NBA', 'G', 'C')).toBe(false)

    const validRoster = validateRoster('NBA', [
      { playerId: 'nba-1', position: 'PG', slotName: 'G' },
      { playerId: 'nba-2', position: 'PF', slotName: 'F' },
      { playerId: 'nba-3', position: 'C', slotName: 'UTIL' },
    ])
    expect(validRoster.valid).toBe(true)
  })

  it('MLB: pitcher/utility slots respect SP/RP and hitter pool rules', () => {
    expect(getAllowedPositionsForSlot('MLB', 'P')).toEqual(expect.arrayContaining(['SP', 'RP']))
    expect(getAllowedPositionsForSlot('MLB', 'UTIL')).toEqual(
      expect.arrayContaining(['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'])
    )

    expect(isPositionEligibleForSlot('MLB', 'P', 'SP')).toBe(true)
    expect(isPositionEligibleForSlot('MLB', 'UTIL', 'SP')).toBe(false)

    const validRoster = validateRoster('MLB', [
      { playerId: 'mlb-1', position: 'SP', slotName: 'P' },
      { playerId: 'mlb-2', position: 'OF', slotName: 'UTIL' },
    ])
    expect(validRoster.valid).toBe(true)
  })

  it('NHL: UTIL accepts skaters but excludes goalies', () => {
    expect(getAllowedPositionsForSlot('NHL', 'UTIL')).toEqual(
      expect.arrayContaining(['C', 'LW', 'RW', 'D'])
    )

    expect(isPositionEligibleForSlot('NHL', 'UTIL', 'LW')).toBe(true)
    expect(isPositionEligibleForSlot('NHL', 'UTIL', 'G')).toBe(false)

    const validRoster = validateRoster('NHL', [
      { playerId: 'nhl-1', position: 'RW', slotName: 'UTIL' },
      { playerId: 'nhl-2', position: 'G', slotName: 'G' },
    ])
    expect(validRoster.valid).toBe(true)
  })

  it('NCAAF: FLEX enforces college football eligibility boundaries; SUPERFLEX is opt-in', () => {
    expect(getAllowedPositionsForSlot('NCAAF', 'FLEX')).toEqual(
      expect.arrayContaining(['RB', 'WR', 'TE'])
    )
    expect(isPositionEligibleForSlot('NCAAF', 'FLEX', 'QB')).toBe(false)
    expect(isPositionEligibleForSlot('NCAAF', 'FLEX', 'RB')).toBe(true)

    const canAddRbToFlex = canAddPlayerToSlot('NCAAF', 'FLEX', 'RB', [])
    expect(canAddRbToFlex.allowed).toBe(true)

    // The default NCAAF template has carried no SUPERFLEX starter since 595959f64 (a commissioner adds
    // one), so the default template offers no superflex slot to place a QB in.
    expect(getAllowedPositionsForSlot('NCAAF', 'SUPERFLEX')).toEqual([])
    expect(canAddPlayerToSlot('NCAAF', 'SUPERFLEX', 'QB', []).allowed).toBe(false)

    const invalidRoster = validateRoster('NCAAF', [
      { playerId: 'ncaaf-1', position: 'QB', slotName: 'FLEX' },
    ])
    expect(invalidRoster.valid).toBe(false)
  })

  it('NCAAB: UTIL accepts G/F/C while primary slots reject mismatched positions', () => {
    expect(getAllowedPositionsForSlot('NCAAB', 'UTIL')).toEqual(
      expect.arrayContaining(['G', 'F', 'C'])
    )

    expect(isPositionEligibleForSlot('NCAAB', 'UTIL', 'C')).toBe(true)
    expect(isPositionEligibleForSlot('NCAAB', 'F', 'C')).toBe(false)

    const validRoster = validateRoster('NCAAB', [
      { playerId: 'ncaab-1', position: 'G', slotName: 'G' },
      { playerId: 'ncaab-2', position: 'C', slotName: 'UTIL' },
    ])
    expect(validRoster.valid).toBe(true)
  })
})