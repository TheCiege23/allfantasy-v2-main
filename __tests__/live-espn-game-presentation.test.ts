import { describe, expect, it } from 'vitest'
import {
  ballOnFromAwayGoal,
  formatVenueLocation,
  linescoreValues,
  mapGameSituation,
  pickGameLeaders,
} from '@/lib/live/espnGamePresentation'
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
