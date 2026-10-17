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
const FETCHED = '2026-10-12T00:00:00.000Z'

const ROLLING_INSIGHTS: PlayerIdentityRow = {
  sleeperId: '2216',
  sport: 'NFL',
  source: 'rolling_insights',
  fetchedAt: FETCHED,
  name: 'Mike Evans',
  position: 'WR',
  team: 'San Francisco 49ers',
  imageUrl: 'bbba4082-78fc-5d77-80ff-864e72333ad8.png',
}
const THESPORTSDB: PlayerIdentityRow = {
  sleeperId: '2216',
  sport: 'NFL',
  source: 'thesportsdb',
  fetchedAt: FETCHED,
  name: 'Mike Evans',
  position: 'Wide Receiver',
  team: 'San Francisco 49ers',
  imageUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/btst77.png',
}
const SLEEPER: PlayerIdentityRow = {
  sleeperId: '2216',
  sport: 'NFL',
  source: 'sleeper',
  fetchedAt: FETCHED,
  name: 'Mike Evans',
  position: 'WR',
  team: 'SF',
  imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/2216.jpg',
}

describe('composePlayerIdentities', () => {
  /*
   * The headshot is the Sleeper row's when it has one (every NFL Sleeper row did on
   * 2026-10-12). Without a Sleeper row there is no authority, and the first usable one wins.
   */
  it('takes the headshot from whichever vendor has one', () => {
    expect(composePlayerIdentities([ROLLING_INSIGHTS, THESPORTSDB, SLEEPER]).get('2216')?.imageUrl).toBe(
      'https://sleepercdn.com/content/nfl/players/thumb/2216.jpg',
    )
    expect(composePlayerIdentities([ROLLING_INSIGHTS, THESPORTSDB]).get('2216')?.imageUrl).toBe(
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
      { sleeperId: '9', sport: 'SOCCER', source: 'thesportsdb', fetchedAt: FETCHED, name: 'Someone', position: 'FW', team: 'West Ham United', imageUrl: null },
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
      { sleeperId: '77', sport: 'NBA', source: 'thesportsdb', fetchedAt: FETCHED, name: 'Some Forward', position: 'PF', team: 'Atlanta Hawks', imageUrl: null },
    ]).get('77')
    expect(got?.team).toBe('Atlanta Hawks')
    expect(got?.sport).toBe('NBA')
  })

  it('still folds an NFL club spelled out in full', () => {
    const got = composePlayerIdentities([
      { sleeperId: '78', sport: 'NFL', source: 'sleeper', fetchedAt: FETCHED, name: 'Some Back', position: 'RB', team: 'Atlanta Falcons', imageUrl: null },
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
      source: 'thesportsdb',
      fetchedAt: FETCHED,
      name: 'Antonio Williams',
      position: null,
      team: 'Washington Commanders',
      imageUrl: 'https://r2.thesportsdb.com/images/media/player/thumb/avr4nv1.png',
    }
    const sleeperRow: PlayerIdentityRow = {
      sleeperId: '13301',
      sport: 'NFL',
      source: 'sleeper',
      fetchedAt: FETCHED,
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
      { sleeperId: null, sport: 'NFL', source: 'sleeper', fetchedAt: FETCHED, name: 'Nobody', position: 'QB', team: 'BAL', imageUrl: null },
      SLEEPER,
    ])
    expect(map.size).toBe(1)
    expect(map.get('2216')?.name).toBe('Mike Evans')
  })

  /* Two different athletes must not merge, however similar their rows look. */
  it('never merges across sleeper ids', () => {
    const map = composePlayerIdentities([
      SLEEPER,
      { sleeperId: '4881', sport: 'NFL', source: 'sleeper', fetchedAt: FETCHED, name: 'Lamar Jackson', position: 'QB', team: 'BAL', imageUrl: null },
    ])
    expect(map.get('2216')?.name).toBe('Mike Evans')
    expect(map.get('4881')?.name).toBe('Lamar Jackson')
    expect(map.get('4881')?.imageUrl).toBeNull()
  })
})

/*
 * 🛑 THE SLEEPER ROW IS THE IDENTITY (lib/player-match/authoritativePlayerRow.ts). The vendor rows
 * got their Sleeper id from a NAME match, and a free agent's vendor row keeps his LAST club. Row
 * shapes below are production's, measured on redraft rosters 2026-10-12.
 */
describe('composePlayerIdentities — the Sleeper row is authoritative', () => {
  const row = (r: Partial<PlayerIdentityRow> & { sleeperId: string; source: string }): PlayerIdentityRow => ({
    sport: 'NFL',
    fetchedAt: FETCHED,
    name: null,
    position: null,
    team: null,
    imageUrl: null,
    ...r,
  })
  const both = (a: PlayerIdentityRow, b: PlayerIdentityRow) => [
    [a, b],
    [b, a],
  ]

  it('a Sleeper free agent keeps a null club, whatever club the vendor row remembers', () => {
    const sleeper = row({ sleeperId: '3321', source: 'sleeper', name: 'Tyreek Hill', position: 'WR', imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/3321.jpg' })
    const vendor = row({ sleeperId: '3321', source: 'rolling_insights', name: 'Tyreek Hill', position: 'WR', team: 'MIA' })
    for (const rows of both(sleeper, vendor)) {
      const got = composePlayerIdentities(rows).get('3321')
      expect(got?.team).toBeNull()
      expect(got?.position).toBe('WR')
    }
  })

  it('a namesake in another position group lends nothing — not position, club, name or face', () => {
    const sleeper = row({ sleeperId: '5864', source: 'sleeper', name: 'Byron Murphy', position: 'CB', team: 'MIN', imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/5864.jpg' })
    const tsdb = row({ sleeperId: '5864', source: 'thesportsdb', name: 'Byron Murphy', position: 'DT', team: 'Seattle Seahawks', imageUrl: 'https://img.example/tsdb/murphy-dt.png' })
    for (const rows of both(sleeper, tsdb)) {
      expect(composePlayerIdentities(rows).get('5864')).toEqual({
        name: 'Byron Murphy',
        position: 'CB',
        sport: 'NFL',
        team: 'MIN',
        imageUrl: 'https://sleepercdn.com/content/nfl/players/thumb/5864.jpg',
      })
    }
    const ty = row({ sleeperId: '6039', source: 'sleeper', name: 'Ty Johnson', position: 'RB', team: 'BUF' })
    const tyler = row({ sleeperId: '6039', source: 'thesportsdb', name: 'Tyler Johnson', position: 'WR', team: 'DAL', imageUrl: 'https://img.example/tsdb/tyler.png' })
    for (const rows of both(ty, tyler)) {
      expect(composePlayerIdentities(rows).get('6039')).toMatchObject({ name: 'Ty Johnson', position: 'RB', team: 'BUF', imageUrl: null })
    }
  })

  it('an AGREEING row still fills a gap the Sleeper row has — a bare filename counts as a gap', () => {
    const sleeper = row({ sleeperId: '2216', source: 'sleeper', name: 'Mike Evans', position: 'WR', team: 'SF', imageUrl: 'bbba4082.png' })
    const tsdb = row({ sleeperId: '2216', source: 'thesportsdb', name: 'Mike Evans', position: 'WR', team: 'SF', imageUrl: 'https://img.example/tsdb/evans.png' })
    for (const rows of both(sleeper, tsdb)) {
      expect(composePlayerIdentities(rows).get('2216')?.imageUrl).toBe('https://img.example/tsdb/evans.png')
    }
  })

  it('an agreeing row may re-case the name, never replace it', () => {
    const sleeper = row({ sleeperId: '8151', source: 'sleeper', name: 'kenneth walker', position: 'RB', team: 'SEA' })
    const vendor = row({ sleeperId: '8151', source: 'rolling_insights', name: 'Kenneth Walker', position: 'RB', team: 'SEA' })
    for (const rows of both(sleeper, vendor)) {
      expect(composePlayerIdentities(rows).get('8151')?.name).toBe('Kenneth Walker')
    }
  })
})
