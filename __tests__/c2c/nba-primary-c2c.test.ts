import { describe, expect, it } from 'vitest'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 as CATALOG } from '@/lib/league-creation/options-catalog-seed-data'

describe('NBA C2C in the create form (2026-11-24)', () => {
  it('offers C2C as an NFL or NBA league, sized by the pro player pool, not the real league', () => {
    expect(CATALOG.allowedSportsByConcept.c2c).toEqual(['NFL', 'NBA'])
    expect(Math.max(...getTeamCountOptions('NBA', 'c2c'))).toBe(46)
    expect(Math.max(...getTeamCountOptions('NFL', 'c2c'))).toBe(104)
    expect(Math.min(...getTeamCountOptions('NBA', 'c2c'))).toBe(8)
  })
})

describe('a C2C roster’s second bench and IR never score', () => {
  it('C2C_BN and C2C_IL are not starters; C2C pro seats are', () => {
    expect(isNflRedraftScoringStarterSlot('C2C_BN')).toBe(false)
    expect(isNflRedraftScoringStarterSlot('C2C_IL')).toBe(false)
    expect(isNflRedraftScoringStarterSlot('C2C_PG')).toBe(true)
    expect(isNflRedraftScoringStarterSlot('BN')).toBe(false)
  })
})
