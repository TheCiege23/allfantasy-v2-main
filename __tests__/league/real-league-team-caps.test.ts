/**
 * A pro-sport league is never bigger than the real league (owner's rule, 2026-11-22): NFL and NHL
 * 32 teams, NBA and MLB 30, in every format but Tournament. College Devy and C2C go to the college
 * maximum; an NFL-based one stops at 32.
 */
import { describe, expect, it } from 'vitest'
import { capToRealLeague, PRO_LEAGUE_TEAMS } from '@/lib/league/teamCountLimits'
import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 as CATALOG } from '@/lib/league-creation/options-catalog-seed-data'

describe('capToRealLeague', () => {
  it('drops every size past the real league, for the four pro sports only', () => {
    const sizes = [2, 30, 31, 32, 33, 250]
    expect(capToRealLeague('NFL', 'redraft', sizes)).toEqual([2, 30, 31, 32])
    expect(capToRealLeague('nba', 'dynasty', sizes)).toEqual([2, 30])
    expect(capToRealLeague('MLB', 'guillotine', sizes)).toEqual([2, 30])
    expect(capToRealLeague('NHL', 'zombie', sizes)).toEqual([2, 30, 31, 32])
    for (const sport of ['NCAAF', 'NCAAB', 'SOCCER']) expect(capToRealLeague(sport, 'dynasty', sizes)).toEqual(sizes)
  })

  it('leaves a Tournament, whose sizes are pools of several leagues', () => {
    expect(capToRealLeague('NFL', 'tournament', [32, 64, 224])).toEqual([32, 64, 224])
  })
})

describe('the create form and the catalog agree on every list', () => {
  it('no pro-sport format offers more teams than the real league', () => {
    for (const [type, sports] of Object.entries(CATALOG.allowedSportsByConcept)) {
      if (type === 'tournament') continue
      for (const sport of sports) {
        const max = PRO_LEAGUE_TEAMS[sport]
        if (!max) continue
        const wizard = getTeamCountOptions(sport as never, type as never)
        const catalog = CATALOG.teamCountOptionsByConceptSport[type]?.[sport as never] ?? []
        expect(Math.max(...wizard), `${type} ${sport} wizard`).toBeLessThanOrEqual(max)
        expect(Math.max(0, ...catalog), `${type} ${sport} catalog`).toBeLessThanOrEqual(max)
      }
    }
  })

  it('Redraft and Dynasty reach the real league, and college the native limit', () => {
    for (const type of ['redraft', 'dynasty'] as const) {
      expect(Math.max(...getTeamCountOptions('NFL', type))).toBe(32)
      expect(Math.max(...getTeamCountOptions('NBA', type))).toBe(30)
      expect(Math.max(...getTeamCountOptions('MLB', type))).toBe(30)
      expect(Math.max(...getTeamCountOptions('NHL', type))).toBe(32)
      expect(Math.max(...getTeamCountOptions('NCAAF', type))).toBe(250)
      expect(Math.max(...getTeamCountOptions('NCAAB', type))).toBe(250)
    }
  })

  it('Devy and C2C: 32 for an NFL league, the college maximum for a college one', () => {
    expect(Math.max(...getTeamCountOptions('NFL', 'devy'))).toBe(32)
    expect(Math.max(...getTeamCountOptions('NFL', 'c2c'))).toBe(32)
    expect(Math.max(...getTeamCountOptions('NCAAF', 'c2c'))).toBe(250)
    expect(Math.max(...getTeamCountOptions('NCAAB', 'c2c'))).toBe(250)
    // College Devy fills 10 DEVY seats a team from about 1,700 prospects, so it stops at 170.
    const collegeDevy = getTeamCountOptions('NCAAF', 'devy')
    expect(collegeDevy).toContain(140)
    expect(Math.max(...collegeDevy)).toBe(170)
  })
})
