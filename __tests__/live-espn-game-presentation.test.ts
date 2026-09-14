import { describe, expect, it } from 'vitest'
import {
  ballOnFromAwayGoal,
  basketballPeriodLabel,
  formatVenueLocation,
  linescoreValues,
  mapGameSituation,
  pickGameLeaders,
  pickTeamLeaders,
  teamShooting,
} from '@/lib/live/espnGamePresentation'
import { CHA_LEADERS, CHA_STATS, DET_STATS, PRE_GAME_LEADERS } from './fixtures/espn-nba-scoreboard'
import { groupStartersByPlayer, pointsSummary } from '@/lib/live/liveTieInGroups'

/*
 * Fixture values copied from the live ESPN NFL scoreboard, 2026-09-13, TB @ CIN
 * (TB away, CIN home, TB in possession, "1st & 5 at CIN 12").
 */

describe('ballOnFromAwayGoal', () => {
  it('places the ball on the HOME side from the home prefix, not from the raw yard marker', () => {
    // CIN is home; the CIN 12 is 88 yards from TB's goal line.
    expect(ballOnFromAwayGoal('CIN 12', 'CIN', 'TB')).toBe(88)
  })

  it('places the ball on the AWAY side from the away prefix', () => {
    expect(ballOnFromAwayGoal('TB 12', 'CIN', 'TB')).toBe(12)
  })

  it('reads midfield with or without a prefix', () => {
    expect(ballOnFromAwayGoal('50', 'CIN', 'TB')).toBe(50)
  })

  it('refuses what it cannot place rather than guessing', () => {
    expect(ballOnFromAwayGoal('KC 20', 'CIN', 'TB')).toBeNull()
    expect(ballOnFromAwayGoal('CIN 72', 'CIN', 'TB')).toBeNull()
    expect(ballOnFromAwayGoal('12', 'CIN', 'TB')).toBeNull()
    expect(ballOnFromAwayGoal(undefined, 'CIN', 'TB')).toBeNull()
  })
})

describe('pickGameLeaders', () => {
  const categories = [
    {
      name: 'receivingYards',
      shortDisplayName: 'REC',
      leaders: [
        {
          displayValue: '3 REC, 39 YDS',
          team: { id: '27' },
          athlete: {
            displayName: 'Emeka Egbuka',
            headshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/4567750.png',
            position: { abbreviation: 'WR' },
          },
        },
      ],
    },
    {
      name: 'passingYards',
      shortDisplayName: 'PASS',
      leaders: [
        {
          displayValue: '9/12, 73 YDS',
          team: { id: '27' },
          athlete: { displayName: 'Baker Mayfield', position: { abbreviation: 'QB' } },
        },
      ],
    },
    // Pre-game shape: a category with no athlete must not produce a row.
    { name: 'rushingYards', shortDisplayName: 'RUSH', leaders: [{ displayValue: '' }] },
  ]

  it('orders football leaders PASS, RUSH, REC and drops a category with no athlete', () => {
    const leaders = pickGameLeaders(categories)
    expect(leaders.map((l) => l.label)).toEqual(['PASS', 'REC'])
    expect(leaders[0]).toMatchObject({ name: 'Baker Mayfield', statLine: '9/12, 73 YDS', position: 'QB', teamId: '27' })
    expect(leaders[1]?.headshot).toMatch(/4567750\.png$/)
  })

  it('returns an empty list, not null, when the feed sends nothing', () => {
    expect(pickGameLeaders(undefined)).toEqual([])
  })
})

describe('mapGameSituation', () => {
  it('keeps down/distance, possession, red zone, timeouts and the last play', () => {
    const s = mapGameSituation(
      {
        down: 1,
        distance: 5,
        yardLine: 12,
        downDistanceText: '1st & 5 at CIN 12',
        shortDownDistanceText: '1st & 5',
        possessionText: 'CIN 12',
        possession: '27',
        isRedZone: true,
        homeTimeouts: 3,
        awayTimeouts: 2,
        lastPlay: { text: 'B.Irving left tackle to CIN 12 for 5 yards', type: { text: 'Rush' } },
      },
      'CIN',
      'TB',
    )
    expect(s).toMatchObject({
      downDistanceText: '1st & 5 at CIN 12',
      distance: 5,
      possessionTeamId: '27',
      ballOnFromAway: 88,
      isRedZone: true,
      homeTimeouts: 3,
      awayTimeouts: 2,
      lastPlayText: 'B.Irving left tackle to CIN 12 for 5 yards',
    })
  })

  it('is null when the situation carries nothing drawable', () => {
    expect(mapGameSituation({ homeTimeouts: 3 }, 'CIN', 'TB')).toBeNull()
    expect(mapGameSituation(undefined, 'CIN', 'TB')).toBeNull()
  })
})

describe('venue and line score', () => {
  it('formats a city and state', () => {
    expect(formatVenueLocation({ city: 'Cincinnati', state: 'OH', country: 'USA' })).toBe('Cincinnati, OH')
    expect(formatVenueLocation({ city: 'London', country: 'England' })).toBe('London, England')
    expect(formatVenueLocation(undefined)).toBeNull()
  })

  it('reads per-period values in order', () => {
    expect(linescoreValues([{ value: 14 }, { value: 0 }])).toEqual([14, 0])
    expect(linescoreValues(undefined)).toEqual([])
  })
})

describe('groupStartersByPlayer', () => {
  const base = { position: 'WR', imageUrl: null, points: null as number | null }
  const tieIns = [
    { ...base, leagueId: 'a', leagueName: 'Alpha', playerId: 'p1', playerName: 'Makai Lemon', isStarter: true, points: 4.1 },
    { ...base, leagueId: 'b', leagueName: 'Bravo', playerId: 'p1', playerName: 'Makai Lemon', isStarter: true, points: 6.3 },
    { ...base, leagueId: 'c', leagueName: 'Charlie', playerId: 'p1', playerName: 'Makai Lemon', isStarter: false, points: 9 },
    { ...base, leagueId: 'a', leagueName: 'Alpha', playerId: 'p2', playerName: 'DeVonta Smith', isStarter: false },
  ]

  it('keeps starters only, one row per player, leagues underneath', () => {
    const groups = groupStartersByPlayer(tieIns)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.playerName).toBe('Makai Lemon')
    expect(groups[0]?.leagues.map((l) => l.leagueName)).toEqual(['Alpha', 'Bravo'])
  })

  it('summarises points as a range across the leagues he starts in, bench excluded', () => {
    expect(pointsSummary(groupStartersByPlayer(tieIns)[0]!)).toEqual({ min: 4.1, max: 6.3 })
  })

  it('reports no summary, not zero, when no league has scored him', () => {
    const [g] = groupStartersByPlayer([{ ...tieIns[0]!, points: null }])
    expect(pointsSummary(g!)).toBeNull()
  })
})

/* Values from the live MLB scoreboard, 2026-09-13, COL @ DET "Bot 7th". */
describe('baseball situation', () => {
  const mlb = {
    balls: 0,
    strikes: 0,
    outs: 2,
    onFirst: true,
    onSecond: true,
    onThird: false,
    batter: {
      athlete: {
        displayName: 'Zach McKinstry',
        headshot: 'https://a.espncdn.com/i/headshots/mlb/players/full/38420.png',
        position: 'RF',
        team: { id: '6' },
      },
      summary: '0-1, 2 R, 2 BB, K',
    },
    pitcher: { athlete: { displayName: 'Jimmy Herget', team: { id: '27' } }, summary: '1.2 IP, 0 ER, H, K, BB' },
    lastPlay: { text: 'Jimmy Herget pitches to Zach McKinstry', type: { text: 'Start Batter/Pitcher' } },
  }

  it('keeps runners, the count, batter and pitcher', () => {
    const s = mapGameSituation(mlb, 'DET', 'COL')
    expect(s?.baseball).toMatchObject({
      onFirst: true,
      onSecond: true,
      onThird: false,
      balls: 0,
      strikes: 0,
      outs: 2,
      batter: { name: 'Zach McKinstry', position: 'RF', summary: '0-1, 2 R, 2 BB, K', teamId: '6' },
      pitcher: { name: 'Jimmy Herget', summary: '1.2 IP, 0 ER, H, K, BB' },
    })
    // Nothing football-shaped is invented for a baseball game.
    expect(s?.ballOnFromAway).toBeNull()
  })

  it('a count of 0-0 with nobody out is a real count, not a missing one', () => {
    const s = mapGameSituation({ balls: 0, strikes: 0, outs: 0, onFirst: false, onSecond: false, onThird: false }, 'DET', 'COL')
    expect(s?.baseball).toMatchObject({ balls: 0, strikes: 0, outs: 0, onFirst: false })
  })

  it('a football situation carries no baseball block', () => {
    const s = mapGameSituation({ downDistanceText: '1st & 5 at CIN 12', possessionText: 'CIN 12' }, 'CIN', 'TB')
    expect(s?.baseball).toBeNull()
  })
})

/* Values from ESPN's NBA scoreboard, DET @ CHA 2026-04-10 (Final, CHA 100). */
describe('basketball team box', () => {
  it('keeps each team PTS, REB, AST in that order with short names, and drops the composite rating', () => {
    const leaders = pickTeamLeaders(CHA_LEADERS)
    expect(leaders.map((l) => [l.label, l.shortName, l.statLine])).toEqual([
      ['Pts', 'L. Ball', '27'],
      ['Reb', 'M. Bridges', '8'],
      ['Ast', 'L. Ball', '8'],
    ])
    expect(leaders[0]).toMatchObject({ name: 'LaMelo Ball', position: 'G', teamId: '30' })
  })

  it('keeps the order even when the feed sends the categories shuffled', () => {
    expect(pickTeamLeaders([...CHA_LEADERS].reverse()).map((l) => l.label)).toEqual(['Pts', 'Reb', 'Ast'])
  })

  it('takes nothing from a scheduled game: its categories are season averages', () => {
    expect(pickTeamLeaders(PRE_GAME_LEADERS)).toEqual([])
    expect(pickTeamLeaders(undefined)).toEqual([])
  })

  it('reads shooting as made-attempted with ESPN percentage text, and it adds up to the score', () => {
    const cha = teamShooting(CHA_STATS)
    expect(cha).toEqual({
      fieldGoals: { made: 34, attempted: 88, pct: '38.6' },
      threePointers: { made: 13, attempted: 47, pct: '27.7' },
      freeThrows: { made: 19, attempted: 23, pct: '82.6' },
    })
    // 2×FGM + 3PM + FTM is the team's points: CHA scored 100.
    expect(2 * cha!.fieldGoals!.made + cha!.threePointers!.made + cha!.freeThrows!.made).toBe(100)
    // DET sends no `threePointPct` — the college basketball shape — and still reads.
    expect(teamShooting(DET_STATS)?.threePointers).toEqual({ made: 9, attempted: 27, pct: '33.3' })
  })

  it('refuses a line it cannot read rather than printing a guess', () => {
    expect(teamShooting(undefined)).toBeNull()
    expect(teamShooting([{ name: 'fieldGoalsMade', displayValue: '40' }, { name: 'fieldGoalsAttempted', displayValue: '--' }])).toBeNull()
    expect(teamShooting([{ name: 'fieldGoalsMade', displayValue: '50' }, { name: 'fieldGoalsAttempted', displayValue: '40' }])).toBeNull()
    expect(teamShooting([{ name: 'freeThrowsMade', displayValue: '5' }, { name: 'freeThrowsAttempted', displayValue: '6' }])).toEqual({
      fieldGoals: null,
      threePointers: null,
      freeThrows: { made: 5, attempted: 6, pct: null },
    })
  })

  it('names basketball periods: NBA quarters, college halves, then OT, 2OT', () => {
    expect([1, 2, 3, 4, 5, 6].map((p) => basketballPeriodLabel('NBA', p))).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT', '2OT'])
    expect([1, 2, 3, 4].map((p) => basketballPeriodLabel('NCAAB', p))).toEqual(['1H', '2H', 'OT', '2OT'])
    expect(basketballPeriodLabel('NBA', 0)).toBeNull()
    expect(basketballPeriodLabel('NHL', 2)).toBeNull()
    expect(basketballPeriodLabel('NFL', 5)).toBeNull()
  })
})
