import { describe, expect, it } from 'vitest'
import { assessProjectionCoverage, parseChimmyProjection } from '@/lib/production-health/projectionCoverageCore'

const input = { id: 'p1', name: 'Example Player', hasWeek: true, lineupAvailable: true, matchup: null }
const linked = { identity: 'linked' as const, name: input.name, games: 0, hasSnapshot: false }

describe('projection coverage report', () => {
  it('keeps a true zero distinct from a missing projection', () => {
    const os = { perGame: 11, weekly: 0, fullSeason: 187, weekGames: 0 }
    expect(assessProjectionCoverage({ ...input, os, matchup: 0 }).mismatches).toEqual(['Roster and scoreboard weekly'])
    const lineup = { points: 0, unavailable: false }
    const agreement = assessProjectionCoverage({ ...input, os, lineup, matchup: 0 })
    expect(agreement.reason).toBe('no_game_this_week')
    expect(agreement.mismatches).toEqual([])
  })

  it('allows an explicit out-player override on the roster reader', () => {
    const os = { perGame: 11, weekly: 11, fullSeason: 187, weekGames: 1 }
    const lineup = { points: 0, unavailable: true }
    expect(assessProjectionCoverage({ ...input, os, lineup, matchup: 11 }).mismatches).toEqual([])
    expect(assessProjectionCoverage({ ...input, os, lineup, matchup: 11, chimmy: {
      state: 'read', weekly: 11, fullSeason: null,
    } }).mismatches).toEqual(['Chimmy full season'])
  })

  it('prioritizes verified scoring inputs and stored projections that did not reach the board', () => {
    for (const evidence of [{ ...linked, games: 2 }, { ...linked, hasSnapshot: true }]) {
      expect(assessProjectionCoverage({ ...input, evidence }).needsProjectionReview).toBe(true)
    }
    expect(assessProjectionCoverage({ ...input, evidence: { ...linked, games: 1 } })).toMatchObject({
      needsProjectionReview: false, reason: 'one_verified_game',
    })
    expect(assessProjectionCoverage({ ...input, evidence: { ...linked, identity: 'ambiguous' } }).reason).toBe('identity_ambiguous')
  })

  it('distinguishes a missing fixture from an offseason weekly check', () => {
    const os = { perGame: 11, weekly: null, fullSeason: 187, weekGames: null }
    expect(assessProjectionCoverage({ ...input, os }).reason).toBe('weekly_schedule_missing')
    expect(assessProjectionCoverage({ ...input, os, hasWeek: false }).reason).toBe('no_regular_week')
  })

  it('checks Chimmy’s named projection format and leaves ambiguous answers ungraded', () => {
    expect(parseChimmyProjection('Example Player · Week 12: 0.00 fantasy points over 0 scheduled team games · 187.00 fantasy points over the full season using stored fixtures', 12))
      .toEqual({ state: 'read', weekly: 0, fullSeason: 187 })
    expect(parseChimmyProjection('Several players match this name. Ask which player the user meant.', 12).state).toBe('ambiguous')
    expect(parseChimmyProjection('Nothing can be read here.', 12).state).toBe('unrecognized')
  })
})
