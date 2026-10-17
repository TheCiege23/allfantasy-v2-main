/**
 * An imported roster's team defence → Sleeper's id for that defence (the club code), or nothing.
 *
 * Owner decision 2026-10-13: score foreign team defences. The player crosswalk (`PlayerIdentityMap`) has
 * no row for one, so since the foreign-id fix every ESPN and Fleaflicker D/ST read no score. The fixtures
 * below are the production rows as read 2026-10-13 — every distinct ESPN negative id and every Fleaflicker
 * D/ST on an active NFL redraft roster — so a rule that stops mapping one of them goes red here.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { espnDefenseTeamAbbreviation } from '@/lib/league-import/espn/espnTeamDefenseIds'
import { nflTeamCodeOf, teamDefenseSleeperId } from '@/lib/core-app/teamDefenseCrosswalk'
import { sleeperLookupId, withTeamDefenseIds } from '@/lib/core-app/rosterIdCrosswalk'
import { espnDefenseIdentity } from '@/lib/espn/espnAthleteFetch'
import { ESPN_TEAM_ABBREVIATIONS } from '@/lib/league-import/espn/EspnLeagueFetchService'

/** [id, name, team, position] — production ESPN D/ST rows (name and team as the importer stored them). */
const ESPN_ROWS: Array<[string, string, string | null, string]> = [
  ['-16001', 'Falcons D/ST', 'ATL', 'D/ST'], ['-16002', 'Bills D/ST', 'BUF', 'D/ST'],
  ['-16003', 'Bears D/ST', 'CHI', 'D/ST'], ['-16004', 'Bengals D/ST', 'CIN', 'D/ST'],
  ['-16005', 'Browns D/ST', 'CLE', 'D/ST'], ['-16006', 'Cowboys D/ST', 'DAL', 'D/ST'],
  ['-16007', 'Broncos D/ST', 'DEN', 'D/ST'], ['-16008', 'Lions D/ST', 'DET', 'D/ST'],
  ['-16009', 'Packers D/ST', 'GB', 'D/ST'], ['-16012', 'Chiefs D/ST', 'KC', 'D/ST'],
  ['-16013', 'Raiders D/ST', 'LV', 'D/ST'], ['-16014', 'Rams D/ST', 'LAR', 'D/ST'],
  ['-16016', 'Vikings D/ST', 'MIN', 'D/ST'], ['-16017', 'Patriots D/ST', 'NE', 'D/ST'],
  ['-16020', 'Jets D/ST', 'NYJ', 'D/ST'], ['-16021', 'Eagles D/ST', 'PHI', 'D/ST'],
  ['-16023', 'Steelers D/ST', 'PIT', 'D/ST'], ['-16024', 'Chargers D/ST', 'LAC', 'D/ST'],
  ['-16025', '49ers D/ST', 'SF', 'D/ST'], ['-16026', 'Seahawks D/ST', 'SEA', 'D/ST'],
  ['-16028', 'Commanders D/ST', 'WAS', 'D/ST'], ['-16029', 'Panthers D/ST', 'CAR', 'D/ST'],
  ['-16030', 'Jaguars D/ST', 'JAX', 'D/ST'], ['-16033', 'Ravens D/ST', 'BAL', 'D/ST'],
  ['-16034', 'Texans D/ST', 'HOU', 'D/ST'],
  // The importer could not label these: position UNK, the id as the name, no team.
  ...['-16008', '-16012', '-16016', '-16021', '-16023', '-16024', '-16025', '-16027', '-16033'].map(
    (id): [string, string, string | null, string] => [id, id, null, 'UNK'],
  ),
]

/** [id, name, team] — the 16 production Fleaflicker D/ST rows. The id names nothing; the row does. */
const FLEAFLICKER_ROWS: Array<[string, string, string, string]> = [
  ['2330', 'Baltimore Ravens', 'Ravens', 'BAL'], ['2333', 'Chicago Bears', 'Bears', 'CHI'],
  ['2334', 'Cincinnati Bengals', 'Bengals', 'CIN'], ['2337', 'Denver Broncos', 'Broncos', 'DEN'],
  ['2339', 'Green Bay Packers', 'Packers', 'GB'], ['2340', 'Houston Texans', 'Texans', 'HOU'],
  ['2342', 'Jacksonville Jaguars', 'Jaguars', 'JAX'], ['2343', 'Kansas City Chiefs', 'Chiefs', 'KC'],
  ['2345', 'Minnesota Vikings', 'Vikings', 'MIN'], ['2350', 'Las Vegas Raiders', 'Raiders', 'LV'],
  ['2351', 'Philadelphia Eagles', 'Eagles', 'PHI'], ['2352', 'Pittsburgh Steelers', 'Steelers', 'PIT'],
  ['2353', 'Los Angeles Chargers', 'Chargers', 'LAC'], ['2355', 'San Francisco 49ers', '49ers', 'SF'],
  ['2356', 'Los Angeles Rams', 'Rams', 'LAR'], ['2359', 'Washington Commanders', 'Commanders', 'WAS'],
]

/** The 32 DEF ids on production Sleeper rosters — what a translation must land on. */
const SLEEPER_DEF_IDS = new Set(
  'ARI,ATL,BAL,BUF,CAR,CHI,CIN,CLE,DAL,DEN,DET,GB,HOU,IND,JAX,KC,LAC,LAR,LV,MIA,MIN,NE,NO,NYG,NYJ,PHI,PIT,SEA,SF,TB,TEN,WAS'.split(','),
)

describe('ESPN: the D/ST id is the club', () => {
  it('-16000 - proTeamId, over the importer\'s own table', () => {
    expect(espnDefenseTeamAbbreviation('-16012')).toBe('KC')
    expect(espnDefenseTeamAbbreviation('-16033')).toBe('BAL')
    expect(espnDefenseTeamAbbreviation(' -16034 ')).toBe('HOU')
  })

  it('is not an ESPN D/ST: a positive athlete id, -16000, an unused team number, junk', () => {
    for (const id of ['12483', '16012', '-16000', '-16031', '-16100', '-1', '', 'KC', null]) {
      expect(espnDefenseTeamAbbreviation(id)).toBeNull()
    }
  })

  it('the importer and the athlete ingest still see the one table and the same identity', () => {
    expect(ESPN_TEAM_ABBREVIATIONS[12]).toBe('KC')
    expect(espnDefenseIdentity('-16012', ESPN_TEAM_ABBREVIATIONS)).toEqual({ id: '-16012', displayName: 'KC D/ST' })
    expect(espnDefenseIdentity('12483', ESPN_TEAM_ABBREVIATIONS)).toBeNull()
  })

  it.each(ESPN_ROWS)('production row %s (%s, %s, %s) → its club', (playerId, playerName, team, position) => {
    const code = teamDefenseSleeperId('espn', { playerId, playerName, team, position })
    expect(code).toBe(espnDefenseTeamAbbreviation(playerId))
    expect(SLEEPER_DEF_IDS.has(code!)).toBe(true)
  })

  it('🛑 a row that names a DIFFERENT club than its id is a contradiction, not a tie-break', () => {
    expect(teamDefenseSleeperId('espn', { playerId: '-16012', playerName: 'Chiefs D/ST', team: 'BUF', position: 'D/ST' })).toBeNull()
    expect(teamDefenseSleeperId('espn', { playerId: '-16012', playerName: 'Bills D/ST', team: 'KC', position: 'D/ST' })).toBeNull()
  })

  it('🛑 a negative id on a row that says it is a skill player is not taken as a defence', () => {
    expect(teamDefenseSleeperId('espn', { playerId: '-16012', playerName: 'Patrick Mahomes', team: 'KC', position: 'QB' })).toBeNull()
  })

  it('an ESPN athlete id is never a defence', () => {
    expect(teamDefenseSleeperId('espn', { playerId: '12483', playerName: 'Matthew Stafford', team: 'LAR', position: 'QB' })).toBeNull()
  })
})

describe('Fleaflicker (and any platform whose id names nothing): only the row can say it', () => {
  it.each(FLEAFLICKER_ROWS)('production row %s (%s, %s) → %s', (playerId, playerName, team, expected) => {
    expect(teamDefenseSleeperId('fleaflicker', { playerId, playerName, team, position: 'D/ST' })).toBe(expected)
  })

  it('🛑 the name must itself be a club — a person in a D/ST slot is not a defence', () => {
    expect(teamDefenseSleeperId('fleaflicker', { playerId: '2343', playerName: 'Travis Kelce', team: 'Chiefs', position: 'D/ST' })).toBeNull()
    expect(teamDefenseSleeperId('fleaflicker', { playerId: '2343', playerName: null, team: 'Chiefs', position: 'D/ST' })).toBeNull()
  })

  it('🛑 a team label that disagrees with the name refuses the row', () => {
    expect(teamDefenseSleeperId('fleaflicker', { playerId: '2343', playerName: 'Kansas City Chiefs', team: 'Raiders', position: 'D/ST' })).toBeNull()
  })

  it('🛑 a club name in a non-defence slot is not a defence', () => {
    expect(teamDefenseSleeperId('fleaflicker', { playerId: '2343', playerName: 'Kansas City Chiefs', team: 'Chiefs', position: 'WR' })).toBeNull()
  })

  it('🛑 a bare city names two clubs and is refused ("Los Angeles", "New York")', () => {
    expect(nflTeamCodeOf('Los Angeles')).toBeNull()
    expect(nflTeamCodeOf('New York')).toBeNull()
    expect(teamDefenseSleeperId('fleaflicker', { playerId: '1', playerName: 'Los Angeles', team: null, position: 'DEF' })).toBeNull()
  })

  it('codes, code aliases, full names and nicknames resolve; junk does not', () => {
    expect(nflTeamCodeOf('KC')).toBe('KC')
    expect(nflTeamCodeOf('JAC')).toBe('JAX')
    expect(nflTeamCodeOf('WSH')).toBe('WAS')
    expect(nflTeamCodeOf('Kansas City Chiefs')).toBe('KC')
    expect(nflTeamCodeOf('49ers')).toBe('SF')
    expect(nflTeamCodeOf('XYZ')).toBeNull()
    expect(nflTeamCodeOf('Josh Allen')).toBeNull()
  })
})

describe('withTeamDefenseIds — opt-in, foreign leagues only, never overriding a disagreement', () => {
  it('adds the defence beside the player crosswalk, and sleeperLookupId resolves it', () => {
    const rows = [
      { playerId: '-16012', playerName: 'Chiefs D/ST', team: 'KC', position: 'D/ST' },
      { playerId: '12483', playerName: 'Matthew Stafford', team: 'LAR', position: 'QB' },
    ]
    const map = withTeamDefenseIds('espn', new Map([['12483', '4881']]), rows)
    expect(sleeperLookupId('espn', '-16012', map)).toBe('KC')
    expect(sleeperLookupId('espn', '12483', map)).toBe('4881')
  })

  it('a Sleeper-space league is returned unchanged — its defence id already is the club code', () => {
    const rows = [{ playerId: '-16012', playerName: 'Chiefs D/ST', team: 'KC', position: 'D/ST' }]
    expect([...withTeamDefenseIds('sleeper', new Map(), rows)]).toEqual([])
  })

  it('🛑 an id the player crosswalk maps to someone else is dropped, not resolved to either', () => {
    const rows = [{ playerId: '2343', playerName: 'Kansas City Chiefs', team: 'Chiefs', position: 'D/ST' }]
    const map = withTeamDefenseIds('fleaflicker', new Map([['2343', '9999']]), rows)
    expect(sleeperLookupId('fleaflicker', '2343', map)).toBeNull()
  })
})
