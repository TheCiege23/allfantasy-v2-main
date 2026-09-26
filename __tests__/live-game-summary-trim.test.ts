import { describe, expect, it } from 'vitest'
import { athletesInPlayText, summaryTtlMs, trimEspnGameSummary } from '@/lib/live/espnGameSummary'
import { gameDetailHref } from '@/lib/live/gameDetailLink'

/*
 * A hand-cut subset of ESPN's NFL summary for TB @ CIN (401872925), keeping the
 * field names and value formats measured live on 2026-09-13. CIN is home, TB away.
 */
function rawSummary(over: { state?: 'pre' | 'in' | 'post'; current?: boolean } = {}) {
  const state = over.state ?? 'in'
  const currentDrive = {
    id: 'd17',
    description: '2 plays, 32 yards, 1:02',
    team: { id: '4', abbreviation: 'CIN', logos: [{ href: 'https://a.espncdn.com/i/teamlogos/nfl/500/cin.png' }] },
    start: { text: 'CIN 24', yardLine: 24, period: { number: 4 }, clock: { displayValue: '3:19' } },
    end: { text: 'TB 44' },
    displayResult: '',
    isScore: false,
    plays: [
      {
        id: 'p1',
        type: { text: 'Pass Reception', abbreviation: 'REC' },
        text: ' (Shotgun) J.Burrow pass short right to S.Perine to TB 44 for 14 yards (A.Winfield).',
        period: { number: 4 },
        clock: { displayValue: '2:26' },
        statYardage: 14,
        yardsAfterCatch: 12,
        scoringPlay: false,
        start: { down: 1, distance: 10, downDistanceText: '1st & 10 at CIN 42', possessionText: 'CIN 42', team: { id: '4' } },
        end: {
          down: 1,
          distance: 10,
          downDistanceText: '1st & 10 at TB 44',
          shortDownDistanceText: '1st & 10',
          possessionText: 'TB 44',
          team: { id: '4' },
        },
      },
      {
        id: 'p2',
        type: { text: 'Official Timeout', abbreviation: 'Off TO' },
        text: 'Official Timeout at 02:17.',
        start: { down: -1, possessionText: 'TB 44' },
        end: { down: -1 },
      },
    ],
  }
  const athlete = (id: string, displayName: string, headshot?: string) => ({
    athlete: { id, displayName, headshot: headshot ? { href: headshot } : undefined, jersey: '9' },
  })
  return {
    header: {
      competitions: [
        {
          status: { type: { state, shortDetail: state === 'post' ? 'Final' : '2:17 - 4th' }, period: 4, displayClock: '2:17' },
          competitors: [
            {
              homeAway: 'home',
              score: '33',
              possession: true,
              team: { id: '4', abbreviation: 'CIN', displayName: 'Cincinnati Bengals', logo: 'cin.png', color: 'fb4f14' },
              record: [{ type: 'total', summary: '1-0' }],
              linescores: [{ displayValue: '14' }, { displayValue: '10' }, { displayValue: '3' }, { displayValue: '6' }],
            },
            {
              homeAway: 'away',
              score: '20',
              team: { id: '27', abbreviation: 'TB', displayName: 'Tampa Bay Buccaneers', logo: 'tb.png', color: 'bd1c36' },
              record: [{ type: 'total', summary: '0-1' }],
              linescores: [{ displayValue: '3' }, { displayValue: '7' }, { displayValue: '10' }, { displayValue: '0' }],
            },
          ],
        },
      ],
    },
    leaders: [
      {
        team: { id: '4' },
        leaders: [
          {
            name: 'totalTackles',
            displayName: 'Tackles',
            leaders: [{ displayValue: '9', mainStat: { value: '9', label: 'TOT' }, summary: '6 SOLO', athlete: { id: 'b1', displayName: 'Jordan Battle', shortName: 'J. Battle', position: { abbreviation: 'S' } } }],
          },
          {
            name: 'passingYards',
            displayName: 'Passing Yards',
            leaders: [
              {
                displayValue: '24/34, 236 YDS, 1 TD, 1 INT',
                mainStat: { value: '236', label: 'YDS' },
                summary: '24/34, 1 TD, 1 INT',
                athlete: { id: '3915511', displayName: 'Joe Burrow', shortName: 'J. Burrow', headshot: { href: 'burrow.png' }, position: { abbreviation: 'QB' } },
              },
            ],
          },
        ],
      },
      {
        team: { id: '27' },
        leaders: [
          {
            name: 'passingYards',
            displayName: 'Passing Yards',
            leaders: [{ displayValue: '19/23, 177 YDS', mainStat: { value: '177', label: 'YDS' }, summary: '19/23', athlete: { id: 'bm', displayName: 'Baker Mayfield', shortName: 'B. Mayfield', position: { abbreviation: 'QB' } } }],
          },
        ],
      },
    ],
    drives: over.current === false ? { previous: [currentDrive] } : { current: currentDrive, previous: [{ ...currentDrive, id: 'd16', plays: [] }, currentDrive] },
    boxscore: {
      teams: [
        {
          team: { id: '4' },
          statistics: [
            { name: 'totalYards', displayValue: '298' },
            { name: 'thirdDownEff', displayValue: '7-13' },
            { name: 'possessionTime', displayValue: '33:25' },
            { name: 'interceptions', displayValue: '1' },
            { name: 'interceptions', displayValue: '9' },
          ],
        },
        {
          team: { id: '27' },
          statistics: [
            { name: 'totalYards', displayValue: '226' },
            { name: 'thirdDownEff', displayValue: '5-10' },
            { name: 'possessionTime', displayValue: '26:35' },
            { name: 'interceptions', displayValue: '0' },
          ],
        },
      ],
      players: [
        {
          team: { id: '4' },
          statistics: [
            { name: 'passing', labels: ['C/ATT', 'YDS', 'AVG', 'TD', 'INT', 'SACKS', 'RTG'], athletes: [{ ...athlete('3915511', 'Joe Burrow', 'burrow.png'), stats: ['24/34', '236', '6.9', '1', '1', '1-6', '85.2'] }] },
            { name: 'receiving', labels: ['REC', 'YDS', 'AVG', 'TD', 'LONG', 'TGTS'], athletes: [{ ...athlete('perine', 'Samaje Perine'), stats: ['3', '31', '10.3', '0', '14', '3'] }] },
            { name: 'defensive', labels: ['TOT', 'SOLO', 'SACKS', 'TFL'], athletes: [{ ...athlete('allen-cin', 'Josh Allen'), stats: ['2', '1', '0', '0'] }] },
          ],
        },
        {
          team: { id: '27' },
          statistics: [
            { name: 'defensive', labels: ['TOT', 'SOLO', 'SACKS', 'TFL'], athletes: [{ ...athlete('winfield', 'Antoine Winfield Jr.'), stats: ['7', '5', '0', '0'] }, { ...athlete('allen-tb', 'Jalen Allen'), stats: ['1', '1', '0', '0'] }] },
          ],
        },
      ],
    },
    scoringPlays: [
      { id: 's1', type: { text: 'Field Goal Good' }, text: 'Chase McLaughlin 34 Yd Field Goal', period: { number: 1 }, clock: { displayValue: '9:09' }, awayScore: 3, homeScore: 0, team: { abbreviation: 'TB', logo: 'tb.png' } },
    ],
    winprobability: [{ homeWinPercentage: 0.5 }, { homeWinPercentage: 0.9694, tiePercentage: 0 }],
    gameInfo: { venue: { fullName: 'Paycor Stadium', address: { city: 'Cincinnati', state: 'OH' } }, weather: { temperature: 92, conditionId: 'Mostly sunny' } },
    news: { articles: new Array(50).fill({ big: 'x'.repeat(100) }) },
  }
}

const opts = { sport: 'NFL', gameId: '401872925', fetchedAt: '2026-09-13T20:00:00.000Z' }

describe('trimEspnGameSummary', () => {
  it('withholds invalid penalty-transition distance while retaining field position', () => {
    const raw = rawSummary()
    const end = raw.drives.current.plays[0].end!
    end.down = 4
    end.distance = -13
    end.downDistanceText = '4th & -13 at TB 44'
    end.shortDownDistanceText = '4th & -13'
    expect(trimEspnGameSummary(raw, opts)?.situation).toMatchObject({
      downDistance: null, shortDownDistance: null, distance: null,
      possessionText: 'TB 44', ballOn: 44, offense: 'home',
    })
  })

  it('reads both teams from the header, with record, color, line score and possession', () => {
    const d = trimEspnGameSummary(rawSummary(), opts)!
    expect(d.home).toMatchObject({ abbrev: 'CIN', score: 33, record: '1-0', color: 'fb4f14', linescores: [14, 10, 3, 6], possession: true })
    expect(d.away).toMatchObject({ abbrev: 'TB', score: 20, possession: false })
    expect(d.status).toMatchObject({ state: 'in', detail: '2:17 - 4th' })
  })

  it('orders each team\'s leaders passing first, with main stat and summary', () => {
    const d = trimEspnGameSummary(rawSummary(), opts)!
    expect(d.leaders.home.map((l) => l.category)).toEqual(['passingYards', 'totalTackles'])
    expect(d.leaders.home[0]).toMatchObject({ name: 'Joe Burrow', mainValue: '236', mainLabel: 'YDS', summary: '24/34, 1 TD, 1 INT', position: 'QB', headshot: 'burrow.png' })
    expect(d.leaders.away[0]?.name).toBe('Baker Mayfield')
  })

  it('places the next snap from possession text: CIN ball at the TB 44 is 44 from the TB (away) goal', () => {
    const d = trimEspnGameSummary(rawSummary(), opts)!
    expect(d.drive).toMatchObject({ isCurrent: true, description: '2 plays, 32 yards, 1:02', startBallOn: 76 })
    expect(d.situation).toMatchObject({ shortDownDistance: '1st & 10', possessionText: 'TB 44', ballOn: 44, distance: 10, offense: 'home' })
  })

  it('skips the timeout: the last play is the snap, and the play text names Burrow and Perine', () => {
    const d = trimEspnGameSummary(rawSummary(), opts)!
    expect(d.lastPlay?.type).toBe('Pass Reception')
    expect(d.lastPlayAthleteIds).toEqual(['3915511', 'perine'])
  })

  it('keeps the current drive once in the all-drives list', () => {
    const d = trimEspnGameSummary(rawSummary(), opts)!
    expect(d.drives.map((x) => x.id)).toEqual(['d16', 'd17'])
    expect(d.drives[1]?.isCurrent).toBe(true)
  })

  it('on a final there is no current drive: the last drive is shown, not current, with no next-snap situation', () => {
    const d = trimEspnGameSummary(rawSummary({ state: 'post', current: false }), opts)!
    expect(d.drive?.isCurrent).toBe(false)
    expect(d.situation).toBeNull()
  })

  it('builds team-stat bars: ratio shown as made/att and shared by rate; first duplicate stat wins', () => {
    const d = trimEspnGameSummary(rawSummary(), opts)!
    const third = d.teamStats.find((s) => s.key === 'thirdDownEff')!
    expect(third).toMatchObject({ away: '5/10', home: '7/13' })
    expect(third.awayShare + third.homeShare).toBeCloseTo(1)
    expect(third.homeShare).toBeCloseTo((7 / 13) / (7 / 13 + 5 / 10))
    const poss = d.teamStats.find((s) => s.key === 'possessionTime')!
    expect(poss.homeShare).toBeCloseTo(2005 / (2005 + 1595))
  })

  it('reports ESPN win probability as percent after the latest play', () => {
    expect(trimEspnGameSummary(rawSummary(), opts)!.winProbability).toEqual({ home: 96.9, away: 3.1 })
  })

  it('drops the heavy sections: the trimmed detail is a small fraction of the raw payload', () => {
    const raw = rawSummary()
    const d = trimEspnGameSummary(raw, opts)!
    expect(JSON.stringify(d)).not.toContain('x'.repeat(100))
    expect(d.venue).toEqual({ name: 'Paycor Stadium', location: 'Cincinnati, OH' })
    expect(d.weather).toBe('92° · Mostly sunny')
  })

  it('returns null when the payload has no two-team header', () => {
    expect(trimEspnGameSummary({ header: { competitions: [{ competitors: [] }] } }, opts)).toBeNull()
    expect(trimEspnGameSummary(null, opts)).toBeNull()
  })
})

describe('athletesInPlayText', () => {
  const players = {
    burrow: [{ group: 'passing', teamId: '4', name: 'Joe Burrow', headshot: null, jersey: null, labels: [], stats: [] }],
    allenA: [{ group: 'defensive', teamId: '4', name: 'Josh Allen', headshot: null, jersey: null, labels: [], stats: [] }],
    allenB: [{ group: 'defensive', teamId: '27', name: 'Jalen Allen', headshot: null, jersey: null, labels: [], stats: [] }],
    winfield: [{ group: 'defensive', teamId: '27', name: 'Antoine Winfield Jr.', headshot: null, jersey: null, labels: [], stats: [] }],
  }

  it('matches ESPN abbreviations, strips generational suffixes, and caps the list', () => {
    expect(athletesInPlayText('J.Burrow sacked by A.Winfield for -6', players)).toEqual(['burrow', 'winfield'])
    expect(athletesInPlayText('J.Burrow pass to A.Winfield', players, 1)).toEqual(['burrow'])
  })

  it('an abbreviation two players share matches neither', () => {
    expect(athletesInPlayText('J.Burrow sacked by J.Allen', players)).toEqual(['burrow'])
  })
})

describe('cache lifetime and card link', () => {
  it('retains the selected league when opening a core game detail', () => {
    const game = { sport: 'MLB', gameId: '401817091', espnDetail: true }
    expect(gameDetailHref(game, '/core/live', 'league-one')).toBe('/core/live?sport=MLB&game=401817091&league=league-one')
    expect(gameDetailHref(game, '/live', 'league-one')).toBe('/live?sport=MLB&game=401817091')
  })
  it('caches live games briefly and finals for hours', () => {
    expect(summaryTtlMs('in')).toBe(20_000)
    expect(summaryTtlMs('pre')).toBe(300_000)
    expect(summaryTtlMs('post')).toBe(21_600_000)
  })

  it('links only ESPN-sourced cards in a covered sport', () => {
    expect(gameDetailHref({ sport: 'NFL', gameId: '401872925', espnDetail: true }, '/core/live')).toBe('/core/live?sport=NFL&game=401872925')
    expect(gameDetailHref({ sport: 'NCAAF', gameId: '401856682', espnDetail: true }, '/live')).toBe('/live?sport=NCAAF&game=401856682')
    expect(gameDetailHref({ sport: 'NBA', gameId: '401810798', espnDetail: true }, '/live')).toBe('/live?sport=NBA&game=401810798')
    expect(gameDetailHref({ sport: 'NCAAB', gameId: '401825532', espnDetail: true }, '/live')).toBe('/live?sport=NCAAB&game=401825532')
    expect(gameDetailHref({ sport: 'NHL', gameId: '401803363', espnDetail: true }, '/live')).toBe('/live?sport=NHL&game=401803363')
    expect(gameDetailHref({ sport: 'MLB', gameId: '401816920', espnDetail: true }, '/live')).toBe('/live?sport=MLB&game=401816920')
    expect(gameDetailHref({ sport: 'SOCCER', gameId: '401872925', espnDetail: true }, '/live')).toBeNull()
    expect(gameDetailHref({ sport: 'NFL', gameId: '401872925', espnDetail: false }, '/live')).toBeNull()
    expect(gameDetailHref({ sport: 'NFL', gameId: 'abc', espnDetail: true }, '/live')).toBeNull()
  })
})
