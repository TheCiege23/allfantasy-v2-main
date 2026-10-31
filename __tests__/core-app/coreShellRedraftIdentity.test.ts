/**
 * The /core shell's redraft stamp decision (lib/core-app/coreShellRedraftIdentity.ts): a native
 * redraft league gets its sport theme; every other league type, an imported league, an unknown sport
 * and "no league open" keep the default look.
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

  it('an imported redraft league keeps its provider look', () => {
    expect(coreShellRedraftSport(native({ platform: 'sleeper' }))).toBeNull()
    expect(coreShellRedraftSport(native({ platform: 'espn' }))).toBeNull()
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
