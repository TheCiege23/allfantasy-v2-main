/**
 * A pro-sport league is never bigger than the real league (owner's rule, 2026-11-22): NFL and NHL
 * 32 teams, NBA and MLB 30, in every format but Tournament. College Devy and C2C go to the college
 * maximum; an NFL-based one stops at 32.
 */
import { describe, expect, it } from 'vitest'
import { capToRealLeague, PRO_LEAGUE_TEAMS } from '@/lib/league/teamCountLimits'
import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 as CATALOG } from '@/lib/league-creation/options-catalog-seed-data'
import { checkNewLeaguePlayerSupply } from '@/lib/league-creation/playerSupply'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'

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

  it('Devy and C2C: 32 for an NFL league; a college C2C league stops where its PRO side runs out', () => {
    expect(Math.max(...getTeamCountOptions('NFL', 'devy'))).toBe(32)
    expect(Math.max(...getTeamCountOptions('NFL', 'c2c'))).toBe(32)
    // Owner's decision, 2026-11-22: 16 NFL seats a team against about 2,200 NFL players (dynasty supply),
    // 15 NBA seats against about 1,080 NBA players.
    expect(Math.max(...getTeamCountOptions('NCAAF', 'c2c'))).toBe(137)
    expect(Math.max(...getTeamCountOptions('NCAAB', 'c2c'))).toBe(72)
    // College Devy fills 10 DEVY seats a team from about 1,700 prospects, so it stops at 170.
    const collegeDevy = getTeamCountOptions('NCAAF', 'devy')
    expect(collegeDevy).toContain(140)
    expect(Math.max(...collegeDevy)).toBe(170)
  })
})

describe('a college C2C league is sized by its pro side', () => {
  const body = (sport: string, teamCount: number) => ({
    concept: 'c2c', sport, teamCount, draftType: 'snake', leagueName: 'C2C size',
    scoringPreset: sport === 'NCAAF' ? 'ncaaf_half_ppr' : 'ncaab_points',
  })

  it('counts the C2C (pro) seats only, against the pro sport, with the dynasty supply', () => {
    expect(checkNewLeaguePlayerSupply({ sport: 'NCAAF', leagueType: 'c2c', teamCount: 137 })).toMatchObject({ verified: true, ok: true, rosterSpots: 16, pool: 2200 })
    expect(checkNewLeaguePlayerSupply({ sport: 'NCAAB', leagueType: 'c2c', teamCount: 72 })).toMatchObject({ verified: true, ok: true, rosterSpots: 15, pool: 1080 })
    // An NFL C2C league counts its NFL seats, not its college ones: 21 a team, far under the 32-team cap.
    expect(checkNewLeaguePlayerSupply({ sport: 'NFL', leagueType: 'c2c', teamCount: 32 })).toMatchObject({ ok: true, rosterSpots: 21 })
  })

  it('the server refuses one team past the cap, saying why', () => {
    expect(validateCreatePayload(body('NCAAF', 137)).ok).toBe(true)
    const refused = validateCreatePayload(body('NCAAF', 138))
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.errors?.[0]).toMatchObject({ path: 'teamCount', code: 'PLAYER_SUPPLY_EXHAUSTED' })
    expect(validateCreatePayload(body('NCAAB', 73)).ok).toBe(false)
  })

  it('an imported college C2C league keeps its size (Road To Glory runs 180 teams)', () => {
    expect(validateCreatePayload(body('NCAAB', 180), { importedTeamCount: 180 }).ok).toBe(true)
    expect(validateCreatePayload(body('NCAAF', 140), { importedTeamCount: 140 }).ok).toBe(true)
    // The allowance is the import's own count only.
    expect(validateCreatePayload(body('NCAAB', 180), { importedTeamCount: 9 }).ok).toBe(false)
  })
})
