import { describe, it, expect } from 'vitest'
import { getValidGuillotineTeamCountRange, validateGuillotineCreation } from '@/lib/guillotine/GuillotineValidation'
import { guillotineNeedsDoubleElimination, guillotineTeamCountOptions } from '@/lib/guillotine/teamCountLimits'
import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'

const SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const
const ALL = Array.from({ length: 32 }, (_, i) => i + 4) // 4..35
// A pro sport stops at its real league (owner's rule, 2026-11-22): NFL and NHL 32 teams, NBA and MLB 30.
const REAL_LEAGUE: Record<string, number> = { NFL: 32, NBA: 30, MLB: 30, NHL: 32 }
const offered = (sport: string) => ALL.filter((n) => n <= (REAL_LEAGUE[sport] ?? 35))

describe('Guilly team counts: 4–27 single elimination, up to 35 with double-elimination weeks', () => {
  it('offers every count from 4 through 35', () => {
    expect(guillotineTeamCountOptions()).toEqual(ALL)
  })

  it.each(SPORTS)('%s: the wizard and the create catalog offer 4 through 35, or through the real league', (sport) => {
    expect(getTeamCountOptions(sport, 'guillotine')).toEqual(offered(sport))
    expect(LEAGUE_CREATE_OPTIONS_CATALOG_V1.teamCountOptionsByConceptSport.guillotine?.[sport]).toEqual(offered(sport))
  })

  it('accepts a 4-team NHL Guilly league (the reported bug)', async () => {
    const r = await validateGuillotineCreation({ sport: 'NHL', teamCount: 4, rosterMode: 'redraft', draftType: 'snake' })
    expect(r.valid).toBe(true)
  })

  it.each(SPORTS)('%s: accepts 4, 27 and its largest size; refuses 3 and one past it', async (sport) => {
    const max = REAL_LEAGUE[sport] ?? 35
    for (const teamCount of [4, 27, max]) {
      expect((await validateGuillotineCreation({ sport, teamCount })).valid).toBe(true)
    }
    for (const teamCount of [3, max + 1]) {
      expect((await validateGuillotineCreation({ sport, teamCount })).valid).toBe(false)
    }
  })

  it('reports the single-elimination ceiling separately from the hard ceiling', async () => {
    // NHL stops at its 32 teams; a sport with no real-league cap keeps 35.
    expect(await getValidGuillotineTeamCountRange('NHL')).toMatchObject({ min: 4, singleEliminationMax: 27, max: 32 })
    expect(await getValidGuillotineTeamCountRange('NCAAF')).toMatchObject({ min: 4, singleEliminationMax: 27, max: 35 })
    expect(guillotineNeedsDoubleElimination(27)).toBe(false)
    expect(guillotineNeedsDoubleElimination(28)).toBe(true)
  })
})
