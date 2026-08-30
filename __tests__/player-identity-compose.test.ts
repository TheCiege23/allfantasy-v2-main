import { describe, expect, it } from 'vitest'

import {
  composePlayerIdentities,
  type PlayerIdentityRow,
} from '@/lib/core-app/playerIdentityCompose'

/*
 * The shape these tests exist for, in one sentence: three production rows, all
 * genuinely Mike Evans, none of them individually renderable.
 *
 * Every fixture below is a real production row shape (measured 2026-08-30), not
 * an invented worst case — `rolling_insights` really does store a bare `.png`
 * filename where a URL belongs, and `thesportsdb` really does spell positions
 * and clubs out in full.
 */

/** Mike Evans, sleeperId 2216, as each vendor actually writes him. */
const ROLLING_INSIGHTS: PlayerIdentityRow = {
  sleeperId: '2216',
  sport: 'NFL',
  name: 'Mike Evans',
  position: 'WR',
  team: 'San Francisco 49ers',
  imageUrl: 'bbba4082-78fc-5d77-80ff-864e72333ad8.png',
}
const THESPORTSDB: PlayerIdentityRow = {
  sleeperId: '2216',
  sport: 'NFL',
  name: 'Mike Evans',
  position: 'Wide Receiver',
  team: 'San Francisco 49ers',
  imageUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/btst77.png',
}
const SLEEPER: PlayerIdentityRow = {
  sleeperId: '2216',
  sport: 'NFL',
  name: 'Mike Evans',
  position: 'WR',
  team: 'SF',
  imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/2216.jpg',
}

describe('composePlayerIdentities', () => {
  it('takes the headshot from whichever vendor has one', () => {
    const got = composePlayerIdentities([ROLLING_INSIGHTS, THESPORTSDB, SLEEPER]).get('2216')
    expect(got?.imageUrl).toBe(
      'https://r2.thesportsdb.com/images/media/player/cutout/btst77.png',
    )
  })

  /*
   * ⚠ THE REGRESSION ITSELF. `findMany` carries no `orderBy`, so the row that
   * arrives first is whatever Postgres felt like returning. Under the old
   * first-row-wins rule this ordering produced a bare filename, which
   * `asHeadshotUrl` correctly refused — and the screen rendered a grey letter
   * for a player whose headshot was sitting in the very next row.
   */
  it('does not depend on which vendor row arrives first', () => {
    const orderings: PlayerIdentityRow[][] = [
      [ROLLING_INSIGHTS, THESPORTSDB, SLEEPER],
      [SLEEPER, ROLLING_INSIGHTS, THESPORTSDB],
      [THESPORTSDB, SLEEPER, ROLLING_INSIGHTS],
      [ROLLING_INSIGHTS, SLEEPER, THESPORTSDB],
    ]
    for (const rows of orderings) {
      const got = composePlayerIdentities(rows).get('2216')
      expect(got?.imageUrl, `ordering ${rows.map((r) => r.team).join(',')}`).toBeTruthy()
      expect(got?.imageUrl).toMatch(/^https:\/\//)
      expect(got?.position).toBeTruthy()
    }
  })

  /*
   * A bare filename is not a URL and must never reach a `src`. It resolves
   * against the current route, 404s, and a broken-image glyph is worse than the
   * initial it replaced.
   */
  it('refuses a bare filename outright when no vendor has a real URL', () => {
    const got = composePlayerIdentities([ROLLING_INSIGHTS]).get('2216')
    expect(got?.imageUrl).toBeNull()
  })

  /*
   * ⚠ THE CLUB IS THE ONE FIELD WHERE FIRST-WINS IS WRONG. A long name is not
   * incorrect, it is unusable: `teamLogoUrl` upper-cases what it is given, so
   * "San Francisco 49ers" reaches the CDN as "SAN FRANCISCO 49ERS" and no crest
   * comes back. An abbreviation on a later row therefore replaces it.
   */
  it('prefers an abbreviated club over a long name, whichever arrives first', () => {
    expect(composePlayerIdentities([THESPORTSDB, SLEEPER]).get('2216')?.team).toBe('SF')
    expect(composePlayerIdentities([SLEEPER, THESPORTSDB]).get('2216')?.team).toBe('SF')
  })

  /*
   * ⚠ THE FOLD IS NFL-ONLY AND MUST LEAVE OTHER SPORTS ALONE.
   * `normalizeTeamAbbrev` is an NFL table that passes anything else through
   * UPPER-CASED, so running it over an NBA or soccer roster produces a shouty
   * version of the vendor's own string and no closer to a crest. Gated on the
   * row's own sport, a non-NFL club keeps the string the vendor gave.
   */
  it('does not fold a non-NFL club through the NFL table', () => {
    const soccer = composePlayerIdentities([
      { sleeperId: '9', sport: 'SOCCER', name: 'Someone', position: 'FW', team: 'West Ham United', imageUrl: null },
    ]).get('9')
    expect(soccer?.team).toBe('West Ham United')
  })

  /*
   * ⚠ CLUB CODES ARE NOT UNIQUE ACROSS SPORTS. ATL, CHI, DET, MIA and PHI are
   * each both an NFL and an NBA club, which is why `dash34.ts` gates its kickoff
   * join on sport too. An NBA "Atlanta Hawks" must not come back as anything
   * the NFL crest lookup would accept.
   */
  it('leaves an NBA club unfolded even when its code collides with an NFL one', () => {
    const got = composePlayerIdentities([
      { sleeperId: '77', sport: 'NBA', name: 'Some Forward', position: 'PF', team: 'Atlanta Hawks', imageUrl: null },
    ]).get('77')
    expect(got?.team).toBe('Atlanta Hawks')
    expect(got?.sport).toBe('NBA')
  })

  it('still folds an NFL club spelled out in full', () => {
    const got = composePlayerIdentities([
      { sleeperId: '78', sport: 'NFL', name: 'Some Back', position: 'RB', team: 'Atlanta Falcons', imageUrl: null },
    ]).get('78')
    expect(got?.team).toBe('ATL')
  })

  /*
   * Antonio Williams (sleeperId 13301) lost his position exactly this way: the
   * `thesportsdb` row holds a null position, and it is a coin toss whether it
   * or the `sleeper` row arrives first.
   */
  it('fills a null position from a sibling row', () => {
    const tsdbNoPosition: PlayerIdentityRow = {
      sleeperId: '13301',
      sport: 'NFL',
      name: 'Antonio Williams',
      position: null,
      team: 'Washington Commanders',
      imageUrl: 'https://r2.thesportsdb.com/images/media/player/thumb/avr4nv1.png',
    }
    const sleeperRow: PlayerIdentityRow = {
      sleeperId: '13301',
      sport: 'NFL',
      name: 'Antonio Williams',
      position: 'WR',
      team: 'WAS',
      imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/13301.jpg',
    }
    for (const rows of [
      [tsdbNoPosition, sleeperRow],
      [sleeperRow, tsdbNoPosition],
    ]) {
      const got = composePlayerIdentities(rows).get('13301')
      expect(got?.position).toBe('WR')
      expect(got?.team).toBe('WAS')
    }
  })

  /* Rows with no Sleeper id cannot be addressed by any caller, so they are dropped. */
  it('drops rows carrying no sleeper id', () => {
    const map = composePlayerIdentities([
      { sleeperId: null, sport: 'NFL', name: 'Nobody', position: 'QB', team: 'BAL', imageUrl: null },
      SLEEPER,
    ])
    expect(map.size).toBe(1)
    expect(map.get('2216')?.name).toBe('Mike Evans')
  })

  /* Two different athletes must not merge, however similar their rows look. */
  it('never merges across sleeper ids', () => {
    const map = composePlayerIdentities([
      SLEEPER,
      { sleeperId: '4881', sport: 'NFL', name: 'Lamar Jackson', position: 'QB', team: 'BAL', imageUrl: null },
    ])
    expect(map.get('2216')?.name).toBe('Mike Evans')
    expect(map.get('4881')?.name).toBe('Lamar Jackson')
    expect(map.get('4881')?.imageUrl).toBeNull()
  })
})
