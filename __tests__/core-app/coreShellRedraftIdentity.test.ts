/**
 * The /core shell's redraft stamp decision (lib/core-app/coreShellRedraftIdentity.ts): a native
 * redraft league gets its sport theme, and so does an imported one whose fresh record positively says
 * redraft (batch B-ID); every other league type, an unknown sport and "no league open" keep the default look.
 */
import { describe, expect, it } from 'vitest'
import { coreShellRedraftSport } from '@/lib/core-app/coreShellRedraftIdentity'

const native = (over: Record<string, unknown> = {}) => ({ platform: 'allfantasy', sport: 'NFL', leagueType: 'redraft', ...over })

describe('coreShellRedraftSport', () => {
  it.each([
    ['NFL', 'nfl'], ['NBA', 'nba'], ['NHL', 'nhl'], ['MLB', 'mlb'],
    ['NCAAF', 'ncaaf'], ['NCAAB', 'ncaab'], ['SOCCER', 'soccer'],
  ])('a native redraft %s league themes as %s', (sport, theme) => {
    expect(coreShellRedraftSport(native({ sport }))).toBe(theme)
  })

  it('no league open (the cross-league dashboard, career, settings) → default look', () => {
    expect(coreShellRedraftSport(null)).toBeNull()
    expect(coreShellRedraftSport(undefined)).toBeNull()
  })

  it.each([
    ['dynasty type', { leagueType: 'dynasty' }],
    ['keeper type', { leagueType: 'keeper' }],
    ['isDynasty flag', { isDynasty: true }],
    ['best ball', { bestBallMode: true }],
    ['guillotine', { guillotineMode: true }],
    ['guillotine variant', { leagueVariant: 'guillotine' }],
    ['survivor variant', { leagueVariant: 'survivor' }],
    ['no leagueType at all', { leagueType: null }],
  ])('a %s league is not redraft → default look', (_label, over) => {
    expect(coreShellRedraftSport(native(over))).toBeNull()
  })

  it('an imported league whose stored data does not positively say redraft keeps its provider look', () => {
    // The list row carries no settings, and `leagueType: 'redraft'` alone is not evidence for an import.
    expect(coreShellRedraftSport(native({ platform: 'sleeper' }))).toBeNull()
    expect(coreShellRedraftSport(native({ platform: 'espn' }))).toBeNull()
    expect(coreShellRedraftSport(native({ platform: 'yahoo' }), 'yahoo', { settings: { league_type: 'redraft' } })).toBeNull()
  })

  it('an imported redraft league themes from the FRESH record (batch B-ID): the list row has no settings', () => {
    const row = native({ platform: 'sleeper', sport: 'NBA' })
    expect(coreShellRedraftSport(row, 'sleeper', { settings: { sleeper_league_type: 0 } })).toBe('nba')
    expect(coreShellRedraftSport(native({ platform: 'espn', sport: 'MLB' }), 'espn', { settings: { espn_keeper_count: 0 } })).toBe('mlb')
    // Keeper / dynasty / unknown on the fresh record → default.
    expect(coreShellRedraftSport(row, 'sleeper', { settings: { sleeper_league_type: 1 } })).toBeNull()
    expect(coreShellRedraftSport(row, 'sleeper', { settings: {} })).toBeNull()
    // The fresh record's format columns win over the list row's.
    expect(coreShellRedraftSport(row, 'sleeper', { leagueType: 'guillotine', settings: { sleeper_league_type: 0 } })).toBeNull()
    expect(coreShellRedraftSport(row, 'sleeper', { isDynasty: true, settings: { sleeper_league_type: 0 } })).toBeNull()
    // …and a field the fresh record does not carry keeps the row's.
    expect(coreShellRedraftSport(row, 'sleeper', { sport: undefined, settings: { sleeper_league_type: 0 } })).toBe('nba')
  })

  it('a native league is unchanged by a fresh record', () => {
    expect(coreShellRedraftSport(native(), 'allfantasy', { settings: null })).toBe('nfl')
    expect(coreShellRedraftSport(native(), 'allfantasy', null)).toBe('nfl')
  })

  it('an unknown sport is not NFL', () => {
    expect(coreShellRedraftSport(native({ sport: 'CRICKET' }))).toBeNull()
  })

  it("the page's fresh platform read wins over a stale list row, in both directions", () => {
    // List row says native, the fresh record says imported → not themed.
    expect(coreShellRedraftSport(native(), 'sleeper')).toBeNull()
    // List row says imported, the fresh record says native → themed.
    expect(coreShellRedraftSport(native({ platform: 'sleeper' }), 'allfantasy')).toBe('nfl')
    // A blank fresh read falls back to the row.
    expect(coreShellRedraftSport(native(), '  ')).toBe('nfl')
    expect(coreShellRedraftSport(native(), null)).toBe('nfl')
  })
})
