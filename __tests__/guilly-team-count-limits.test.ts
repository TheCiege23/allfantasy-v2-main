import { describe, it, expect } from 'vitest'
import { getValidGuillotineTeamCountRange, validateGuillotineCreation } from '@/lib/guillotine/GuillotineValidation'
import { guillotineNeedsDoubleElimination, guillotineTeamCountOptions } from '@/lib/guillotine/teamCountLimits'
import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const
const ALL = Array.from({ length: 32 }, (_, i) => i + 4) // 4..35

describe('Guilly team counts: 4–27 single elimination, up to 35 with double-elimination weeks', () => {
  it('offers every count from 4 through 35', () => {
    expect(guillotineTeamCountOptions()).toEqual(ALL)
  })

  it.each(SPORTS)('%s: the wizard and the create catalog offer 4 through 35', (sport) => {
    expect(getTeamCountOptions(sport, 'guillotine')).toEqual(ALL)
    expect(LEAGUE_CREATE_OPTIONS_CATALOG_V1.teamCountOptionsByConceptSport.guillotine?.[sport]).toEqual(ALL)
  })

  it('accepts a 4-team NHL Guilly league (the reported bug)', async () => {
    const r = await validateGuillotineCreation({ sport: 'NHL', teamCount: 4, rosterMode: 'redraft', draftType: 'snake' })
    expect(r.valid).toBe(true)
  })

  it.each(SPORTS)('%s: accepts 4, 27 and 35; refuses 3 and 36', async (sport) => {
    for (const teamCount of [4, 27, 35]) {
      expect((await validateGuillotineCreation({ sport, teamCount })).valid).toBe(true)
    }
    for (const teamCount of [3, 36]) {
      expect((await validateGuillotineCreation({ sport, teamCount })).valid).toBe(false)
    }
  })

  it('reports the single-elimination ceiling separately from the hard ceiling', async () => {
    const range = await getValidGuillotineTeamCountRange('NHL')
    expect(range).toMatchObject({ min: 4, singleEliminationMax: 27, max: 35 })
    expect(guillotineNeedsDoubleElimination(27)).toBe(false)
    expect(guillotineNeedsDoubleElimination(28)).toBe(true)
  })
})
