import { describe, expect, it } from 'vitest'

import { buildNextGameMap, type FixtureRow } from '@/lib/core-app/nextGameMap'

/*
 * The fixture map behind My Team's opponent line, kickoff, venue and lineup lock.
 *
 * ⚠ WHY THIS SUITE EXISTS. This map used to be keyed on a RAW club spelling
 * translated back through a `Map<folded, raw>`, and `Map.set` resolves a
 * duplicate key to the last pair — so a club stored under two spellings ended up
 * keyed on one of them and a lookup with the other returned nothing. The screen
 * then showed "no game found for this week" for a player whose game was in the
 * table. Measured on a real roster: two of seven visible starters, written off
 * as thin schedule coverage. 1,172 of 11,960 NFL sleeperIds carry more than one
 * spelling of their club (production, 2026-08-30).
 *
 * Nothing here touches a clock — every kickoff is an explicit Date.
 */

const SUN_1PM = new Date('2026-09-13T17:00:00Z')
const SUN_8PM = new Date('2026-09-13T20:25:00Z')

function fixture(over: Partial<FixtureRow> = {}): FixtureRow {
  return {
    homeTeam: 'BAL',
    awayTeam: 'IND',
    startTime: SUN_1PM,
    seasonType: 'regular',
    venue: 'M&T Bank Stadium',
    ...over,
  }
}

describe('buildNextGameMap', () => {
  it('keys both sides of a fixture on the folded abbreviation', () => {
    const map = buildNextGameMap([fixture()], new Set(['BAL', 'IND']))
    expect(map.get('BAL')).toMatchObject({ opponent: 'IND', home: true })
    expect(map.get('IND')).toMatchObject({ opponent: 'BAL', home: false })
  })

  /*
   * ⚠ THE REGRESSION. The schedule table stores whatever the provider called the
   * club — ESPN writes "Baltimore Ravens", Rolling Insights writes the mascot —
   * while a roster carries "BAL". Both sides fold here, so the lookup key is the
   * same string whichever spelling the row held.
   */
  it('finds the game however the provider spelled the club', () => {
    for (const spelling of ['BAL', 'Baltimore Ravens', 'baltimore ravens']) {
      const map = buildNextGameMap([fixture({ homeTeam: spelling })], new Set(['BAL']))
      expect(map.get('BAL'), `spelling ${spelling}`).toMatchObject({ opponent: 'IND' })
    }
  })

  it('skips clubs nobody on the roster plays for', () => {
    const map = buildNextGameMap([fixture()], new Set(['BAL']))
    expect(map.has('BAL')).toBe(true)
    expect(map.has('IND')).toBe(false)
  })

  /*
   * The lineup locks at the EARLIEST kickoff, so that is the row that has to
   * win — not whichever the provider ordering happened to yield first.
   */
  it('takes the earlier kickoff', () => {
    const late = fixture({ startTime: SUN_8PM, awayTeam: 'PIT' })
    const early = fixture({ startTime: SUN_1PM, awayTeam: 'IND' })
    for (const rows of [
      [late, early],
      [early, late],
    ]) {
      const map = buildNextGameMap(rows, new Set(['BAL']))
      expect(map.get('BAL')?.at).toEqual(SUN_1PM)
      expect(map.get('BAL')?.opponent).toBe('IND')
    }
  })

  /*
   * ⚠ THE SAME FIXTURE ARRIVES ONCE PER PROVIDER AND THEY DISAGREE.
   * TheSportsDB carries no `seasonType`, so on an identical kickoff the row that
   * KNOWS whether this is an exhibition must win — otherwise whether a game can
   * be labelled preseason at all is decided by row order.
   */
  it('prefers the row that knows its season type on an identical kickoff', () => {
    const untyped = fixture({ seasonType: null, venue: null })
    const typed = fixture({ seasonType: 'preseason' })
    for (const rows of [
      [untyped, typed],
      [typed, untyped],
    ]) {
      const got = buildNextGameMap(rows, new Set(['BAL'])).get('BAL')
      expect(got?.typed).toBe(true)
      expect(got?.preseason).toBe(true)
    }
  })

  it('breaks a remaining tie on the row that carries a venue', () => {
    const noVenue = fixture({ venue: null })
    const withVenue = fixture({ venue: 'M&T Bank Stadium' })
    for (const rows of [
      [noVenue, withVenue],
      [withVenue, noVenue],
    ]) {
      expect(buildNextGameMap(rows, new Set(['BAL'])).get('BAL')?.venue).toBe(
        'M&T Bank Stadium',
      )
    }
  })

  /* A row with no kickoff cannot lock a lineup and is not a fixture. */
  it('ignores a row with no kickoff', () => {
    expect(buildNextGameMap([fixture({ startTime: null })], new Set(['BAL'])).size).toBe(0)
  })

  it('ignores a row missing one of its two clubs', () => {
    expect(buildNextGameMap([fixture({ awayTeam: null })], new Set(['BAL'])).size).toBe(0)
  })

  it('returns an empty map for an empty slate', () => {
    expect(buildNextGameMap([], new Set(['BAL'])).size).toBe(0)
  })
})
