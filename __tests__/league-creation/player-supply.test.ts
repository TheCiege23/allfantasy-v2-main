import { describe, expect, it } from 'vitest'

import { checkNewLeaguePlayerSupply } from '@/lib/league-creation/playerSupply'

describe('a new league against the sport\'s player supply', () => {
  it('never refuses the sizes people actually run: 12 teams, and the real league\'s own size', () => {
    for (const [sport, real] of [['NFL', 32], ['NBA', 30], ['NHL', 32], ['MLB', 30]] as const) {
      for (const leagueType of ['redraft', 'dynasty']) {
        expect(checkNewLeaguePlayerSupply({ sport, leagueType, teamCount: 12 }), `${sport} ${leagueType} 12`).toMatchObject({ verified: true, ok: true })
      }
      expect(checkNewLeaguePlayerSupply({ sport, leagueType: 'redraft', teamCount: real }), `${sport} redraft ${real}`).toMatchObject({ ok: true })
    }
  })

  it('🛑 refuses a 250-team NFL league and says the largest size that fits', () => {
    const c = checkNewLeaguePlayerSupply({ sport: 'NFL', leagueType: 'redraft', teamCount: 250 })
    expect(c.ok).toBe(false)
    expect(c.needed).toBe(250 * c.rosterSpots)
    expect(c.message).toMatch(/250-team league drafts .* players, and the NFL has about .* The largest league this roster fits is \d+ teams\./)
    // The size it names is itself accepted, and one more is not.
    expect(checkNewLeaguePlayerSupply({ sport: 'NFL', leagueType: 'redraft', teamCount: c.maxTeams }).ok).toBe(true)
    expect(checkNewLeaguePlayerSupply({ sport: 'NFL', leagueType: 'redraft', teamCount: c.maxTeams + 1 }).ok).toBe(false)
  })

  it('the limits it gives, pinned so a template or supply change is a visible decision', () => {
    const fits = (sport: string, leagueType: string) => checkNewLeaguePlayerSupply({ sport, leagueType, teamCount: 12 }).maxTeams
    expect({
      NFL: [fits('NFL', 'redraft'), fits('NFL', 'dynasty')],
      NBA: [fits('NBA', 'redraft'), fits('NBA', 'dynasty')],
      NHL: [fits('NHL', 'redraft'), fits('NHL', 'dynasty')],
      MLB: [fits('MLB', 'redraft'), fits('MLB', 'dynasty')],
    }).toEqual({ NFL: [73, 88], NBA: [41, 60], NHL: [52, 56], MLB: [50, 53] })
  })

  it('the team-defense seat is not an IDP seat: a standard NFL roster draws on offense only', () => {
    expect(checkNewLeaguePlayerSupply({ sport: 'NFL', leagueType: 'redraft', teamCount: 12 }).pool).toBe(1100)
  })

  it('the owner\'s own pro leagues pass: NFL dynasty at 34, NBA and MLB dynasty at 36', () => {
    expect(checkNewLeaguePlayerSupply({ sport: 'NFL', leagueType: 'dynasty', teamCount: 34 }).ok).toBe(true)
    expect(checkNewLeaguePlayerSupply({ sport: 'NBA', leagueType: 'dynasty', teamCount: 36 }).ok).toBe(true)
    expect(checkNewLeaguePlayerSupply({ sport: 'MLB', leagueType: 'dynasty', teamCount: 36 }).ok).toBe(true)
  })

  it('college leagues are not checked: the owner\'s 140- and 180-team leagues, and 250', () => {
    expect(checkNewLeaguePlayerSupply({ sport: 'NCAAF', leagueType: 'redraft', teamCount: 140 })).toMatchObject({ verified: false, ok: true })
    expect(checkNewLeaguePlayerSupply({ sport: 'NCAAB', leagueType: 'dynasty', teamCount: 180 })).toMatchObject({ verified: false, ok: true })
    expect(checkNewLeaguePlayerSupply({ sport: 'NCAAF', leagueType: 'dynasty', teamCount: 250 }).ok).toBe(true)
  })
})

describe('the server refuses what the wizard refuses', () => {
  it('🛑 POST /api/leagues validation: a 250-team NFL redraft league is refused with the reason; 140-team college is not', async () => {
    const { validateCreatePayload: validateCreateLeague } = await import('@/lib/league-creation/canonical/validateCreateLeague')
    const base = { leagueName: 'Size Check', draftType: 'snake' }
    const nfl = validateCreateLeague({ ...base, concept: 'redraft', sport: 'NFL', teamCount: 250, scoringPreset: 'fb_half_ppr' })
    expect(nfl.ok).toBe(false)
    if (!nfl.ok) expect(nfl.errors?.[0]).toMatchObject({ path: 'teamCount', code: 'PLAYER_SUPPLY_EXHAUSTED' })
    expect(validateCreateLeague({ ...base, concept: 'redraft', sport: 'NFL', teamCount: 32, scoringPreset: 'fb_half_ppr' }).ok).toBe(true)
    expect(validateCreateLeague({ ...base, concept: 'redraft', sport: 'NCAAF', teamCount: 140, scoringPreset: 'ncaaf_half_ppr' }).ok).toBe(true)
    expect(validateCreateLeague({ ...base, concept: 'dynasty', sport: 'NCAAB', teamCount: 180, scoringPreset: 'ncaab_points' }).ok).toBe(true)
  })

  it('the wizard blocks Create with the same sentence', async () => {
    const { analyzeCreateLeagueCompletion } = await import('@/lib/create-league-v2/form-completion')
    const { DEFAULT_V2_STATE } = await import('@/lib/create-league-v2/state')
    const state = { ...DEFAULT_V2_STATE, sport: 'NFL' as const, leagueType: 'redraft' as const, teamCount: 250, name: 'Size Check', draftScheduleLater: true, scoringPresetId: 'fb_half_ppr' }
    const issue = analyzeCreateLeagueCompletion(state).find((i) => i.code === 'player_supply')
    expect(issue?.message).toMatch(/largest league this roster fits is 73 teams/)
    expect(analyzeCreateLeagueCompletion({ ...state, teamCount: 32 }).some((i) => i.code === 'player_supply')).toBe(false)
  })
})
