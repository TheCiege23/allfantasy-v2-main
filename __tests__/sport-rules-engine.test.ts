import { describe, expect, it } from 'vitest'

import {
  getAllowedDraftTypesForSport,
  getRulesForSport,
  getSupportedSports,
  getValidPositions,
  getValidRosterSlotNames,
  isDraftTypeAllowedForSport,
} from '@/lib/sport-rules-engine'
import { PLATFORM_SPORT_RULES_DRAFT_TYPES } from '@/lib/draft-types/draftTypeRegistry'

describe('SportRulesEngine', () => {
  it('supports all required sports', () => {
    expect(getSupportedSports()).toEqual(
      expect.arrayContaining(['NFL', 'NHL', 'NBA', 'MLB', 'NCAAB', 'NCAAF', 'SOCCER'])
    )
  })

  it('returns NFL roster slots matching expected setup', () => {
    const slots = getValidRosterSlotNames('NFL')
    expect(slots).toEqual(expect.arrayContaining(['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST']))
  })

  it('returns expected position families for NBA and MLB', () => {
    const nbaPositions = getValidPositions('NBA')
    const mlbPositions = getValidPositions('MLB')

    expect(nbaPositions).toEqual(expect.arrayContaining(['PG', 'SG', 'SF', 'PF', 'C']))
    expect(mlbPositions).toEqual(
      expect.arrayContaining(['SP', 'RP', '1B', '2B', '3B', 'SS', 'OF'])
    )
  })

  it('returns sport-scoped draft options using base draft ids', () => {
    const nflDraftTypes = getAllowedDraftTypesForSport('NFL')
    expect(nflDraftTypes).toEqual([...PLATFORM_SPORT_RULES_DRAFT_TYPES])
    expect(nflDraftTypes).toEqual(expect.arrayContaining(['snake', 'linear', 'auction']))
  })

  it('maps specialty and execution ids to sport-rules bases for validation', () => {
    expect(isDraftTypeAllowedForSport('NFL', 'devy_snake')).toBe(true)
    expect(isDraftTypeAllowedForSport('NFL', 'c2c_auction')).toBe(true)
    expect(isDraftTypeAllowedForSport('NFL', 'offline')).toBe(true)
    // 595959f64 made mock_draft a redraft draft type on purpose (buildDraftOptionRules still
    // refuses it as a DEFAULT); an unknown id is what must be rejected.
    expect(isDraftTypeAllowedForSport('NFL', 'mock_draft')).toBe(true)
    expect(isDraftTypeAllowedForSport('NFL', 'not_a_draft_type')).toBe(false)
  })

  it('returns scoring and player pool rules for soccer', () => {
    const soccerRules = getRulesForSport('SOCCER')
    expect(soccerRules.scoring.validFormats.length).toBeGreaterThan(0)
    expect(soccerRules.playerPool.validPositions).toEqual(
      expect.arrayContaining(['GKP', 'DEF', 'MID', 'FWD'])
    )
    expect(soccerRules.playerPool.poolSizeLimit).toBeGreaterThan(0)
  })
})
