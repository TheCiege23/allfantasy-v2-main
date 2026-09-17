// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  classifyLeagueFormat,
  competitiveStatus,
  stageOf,
  thirdOf,
  MIN_GAMES_FOR_STANDING,
} from '@/lib/core-app/portfolioClassify'

const sleeperSettings = (over: Record<string, unknown> = {}) => ({
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN'],
  scoring_settings: { rec: 1, pass_td: 4 },
  ...over,
})

describe('league format', () => {
  it('🛑 an untouched keeperCount default of 3 is NOT a keeper league', () => {
    const f = classifyLeagueFormat({ leagueType: 'redraft', keeperCount: 3, keeperCostSystem: 'round_based', keeperRoundPenalty: 1, settings: sleeperSettings() })
    expect(f.concept).toBe('redraft')
    expect(f.family).toBe('redraft')
  })

  it('an explicit keeper league is keeper', () => {
    expect(classifyLeagueFormat({ leagueType: 'keeper', settings: sleeperSettings() }).family).toBe('keeper')
  })

  it('folds devy, c2c and pirate into dynasty; guillotine into redraft; unknown into other', () => {
    expect(classifyLeagueFormat({ leagueType: 'devy' }).family).toBe('dynasty')
    expect(classifyLeagueFormat({ leagueType: 'c2c' }).family).toBe('dynasty')
    expect(classifyLeagueFormat({ leagueType: 'guillotine' }).family).toBe('redraft')
    expect(classifyLeagueFormat({ leagueType: 'zombie' }).family).toBe('other')
    expect(classifyLeagueFormat({ leagueType: '', isDynasty: true }).family).toBe('dynasty')
  })

  it('reads best ball from the mode flag or the variant', () => {
    expect(classifyLeagueFormat({ bestBallMode: true }).bestBall).toBe(true)
    expect(classifyLeagueFormat({ leagueVariant: 'BEST_BALL' }).bestBall).toBe(true)
    expect(classifyLeagueFormat({ leagueVariant: null }).bestBall).toBe(false)
  })

  it('🛑 bare team-defence sacks are not IDP; a defender-only key or the IDP variant is', () => {
    const teamDef = sleeperSettings({ scoring_settings: { rec: 1, sack: 1, int: 2 } })
    expect(classifyLeagueFormat({ settings: teamDef }).idp).toBe(false)
    const idp = sleeperSettings({ scoring_settings: { rec: 1, idp_tkl_solo: 1 } })
    expect(classifyLeagueFormat({ settings: idp }).idp).toBe(true)
    expect(classifyLeagueFormat({ leagueVariant: 'DYNASTY_IDP' }).idp).toBe(true)
  })

  it('detects superflex from the lineup slots', () => {
    const sf = sleeperSettings({ roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'WR', 'BN'] })
    expect(classifyLeagueFormat({ settings: sf }).superflex).toBe(true)
    expect(classifyLeagueFormat({ settings: sleeperSettings() }).superflex).toBe(false)
  })

  it('bands reception scoring and reads TE premium from the rulebook, never a preset id', () => {
    expect(classifyLeagueFormat({ settings: sleeperSettings({ scoring_settings: { rec: 1 } }) }).scoring).toBe('ppr')
    expect(classifyLeagueFormat({ settings: sleeperSettings({ scoring_settings: { rec: 0.5 } }) }).scoring).toBe('half_ppr')
    expect(classifyLeagueFormat({ settings: sleeperSettings({ scoring_settings: { rec: 0 } }) }).scoring).toBe('standard')
    const tep = classifyLeagueFormat({ settings: sleeperSettings({ scoring_settings: { rec: 1, bonus_rec_te: 0.5 } }) })
    expect(tep.tePremium).toBe(true)
    expect(classifyLeagueFormat({ settings: null }).scoring).toBeNull()
  })
})

describe('stage', () => {
  it('🛑 the platform status wins over lifecycleState, which defaults to in_season on import', () => {
    expect(stageOf({ status: 'pre_draft', lifecycleState: 'in_season' })).toBe('pre_draft')
    expect(stageOf({ status: 'drafting', lifecycleState: 'in_season' })).toBe('drafting')
    expect(stageOf({ status: 'complete' })).toBe('complete')
    expect(stageOf({ status: null, lifecycleState: 'in_season' })).toBe('in_season')
    expect(stageOf({ status: 'mystery' })).toBe('unknown')
    expect(stageOf({})).toBe('unknown')
  })
})

describe('competitive status', () => {
  const base = {
    declared: null,
    record: { wins: 3, losses: 1, ties: 0 },
    rank: 2,
    teamCount: 12,
    rosterValueRank: 2,
    valuedTeams: 12,
  } as const

  it('thirds are 1-based and refuse leagues too small to have a middle', () => {
    expect(thirdOf(1, 12)).toBe(1)
    expect(thirdOf(6, 12)).toBe(0)
    expect(thirdOf(12, 12)).toBe(-1)
    expect(thirdOf(1, 3)).toBeNull()
    expect(thirdOf(null, 12)).toBeNull()
    expect(thirdOf(13, 12)).toBeNull()
  })

  it('🛑 what you told Chimmy wins over every number', () => {
    expect(competitiveStatus({ ...base, declared: 'rebuilder' })).toEqual({ status: 'rebuild', source: 'you' })
    expect(competitiveStatus({ ...base, rank: 12, rosterValueRank: 12, declared: 'contender' })).toEqual({
      status: 'contender',
      source: 'you',
    })
  })

  it('agrees when standings and roster value agree, and calls a split the middle', () => {
    expect(competitiveStatus(base)).toEqual({ status: 'contender', source: 'standings_and_value' })
    expect(competitiveStatus({ ...base, rank: 12, rosterValueRank: 11 })).toEqual({ status: 'rebuild', source: 'standings_and_value' })
    expect(competitiveStatus({ ...base, rank: 1, rosterValueRank: 12 })).toEqual({ status: 'middle', source: 'standings_and_value' })
  })

  it(`🛑 ignores a standing before ${MIN_GAMES_FOR_STANDING} games — it is a draft slot, not a result`, () => {
    const early = competitiveStatus({ ...base, record: { wins: 1, losses: 0, ties: 0 }, rank: 12 })
    expect(early).toEqual({ status: 'contender', source: 'roster_value' })
    expect(competitiveStatus({ ...base, record: null })).toEqual({ status: 'contender', source: 'roster_value' })
  })

  it('🛑 refuses a value rank when most of the league is unpriced', () => {
    expect(competitiveStatus({ ...base, record: null, valuedTeams: 5 })).toEqual({ status: 'unknown', source: null })
    expect(competitiveStatus({ ...base, valuedTeams: 5 })).toEqual({ status: 'contender', source: 'standings' })
  })
})
