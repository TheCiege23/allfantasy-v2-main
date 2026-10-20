import { describe, expect, it } from 'vitest'
import { resolveDynastyCreationRoster } from '@/lib/league-creation/canonical/dynastyCreationRoster'

// NA / PROSPECT were being counted as starters for MLB and NHL dynasty leagues.
describe('resolveDynastyCreationRoster starters', () => {
  it.each(['NFL', 'NBA', 'MLB', 'NHL'] as const)('%s starters exclude every reserve slot', (sport) => {
    const roster = resolveDynastyCreationRoster(sport, {})
    for (const key of ['BN', 'BENCH', 'IR', 'IL', 'NA', 'TAXI', 'PROSPECT', 'MINORS']) {
      expect(roster.starters).not.toHaveProperty(key)
    }
  })

  it('MLB keeps NA and PROSPECT on the roster, just not as starters', () => {
    const roster = resolveDynastyCreationRoster('MLB', {})
    expect(roster.slots.NA).toBe(5)
    expect(roster.slots.PROSPECT).toBe(10)
    const starterCount = Object.values(roster.starters).reduce((a, b) => a + b, 0)
    // C, 1B, 2B, 3B, SS, CI, MI, OF×5, UTIL×2, SP×3, RP×2, P×4
    expect(starterCount).toBe(23)
    expect(roster.totalRosterSlots).toBe(23 + 12 + 4 + 5 + 6 + 10)
  })

  it('NHL keeps PROSPECT out of starters', () => {
    const roster = resolveDynastyCreationRoster('NHL', {})
    expect(roster.slots.PROSPECT).toBe(8)
    expect(Object.values(roster.starters).reduce((a, b) => a + b, 0)).toBe(14)
  })
})
