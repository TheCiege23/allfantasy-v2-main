import { describe, expect, it } from 'vitest'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 as CATALOG } from '@/lib/league-creation/options-catalog-seed-data'

describe('NBA C2C in the create form (2026-11-24)', () => {
  it('offers NBA C2C with points scoring, up to the NBA’s 30 teams', () => {
    expect(CATALOG.allowedSportsByConcept.c2c).toEqual(expect.arrayContaining(['NFL', 'NBA', 'NCAAF', 'NCAAB']))
    expect(Math.max(...getTeamCountOptions('NBA', 'c2c'))).toBe(30)
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
