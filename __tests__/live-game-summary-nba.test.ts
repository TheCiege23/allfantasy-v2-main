import { describe, expect, it } from 'vitest'
import { GAME_VIEW_SPORTS, trimEspnGameSummary } from '@/lib/live/espnGameSummary'

/*
 * A hand-cut subset of ESPN's NBA summary for CHI @ GS (401810798, Final/OT),
 * keeping the field names and value formats measured on 2026-09-13. GS home (9),
 * CHI away (4). Includes the sentinel coordinate ESPN writes on free throws.
 */
const SENTINEL = { x: -214748340, y: -214748365 }

function rawNba() {
  const athlete = (id: string, displayName: string, shortName: string, position: string) => ({
    id,
    displayName,
    shortName,
    headshot: { href: `${id}.png` },
    jersey: '0',
    position,
  })
  return {
    header: {
      competitions: [
        {
          status: { type: { state: 'post', shortDetail: 'Final/OT' }, period: 5, displayClock: '0.0' },
          competitors: [
            { homeAway: 'home', score: '124', team: { id: '9', abbreviation: 'GS', displayName: 'Golden State Warriors', color: 'fdb927' }, record: [{ type: 'total', summary: '32-33' }], linescores: ['30', '21', '32', '35', '6'].map((v) => ({ displayValue: v })) },
            { homeAway: 'away', score: '130', team: { id: '4', abbreviation: 'CHI', displayName: 'Chicago Bulls', color: 'ce1141' }, record: [{ type: 'total', summary: '27-38' }], linescores: ['26', '31', '32', '29', '12'].map((v) => ({ displayValue: v })) },
          ],
        },
      ],
    },
    leaders: [
      {
        team: { id: '4', abbreviation: 'CHI' },
        leaders: [
          { name: 'rebounds', displayName: 'Rebounds', leaders: [{ displayValue: '13', mainStat: { value: '13', label: 'REB' }, summary: '11 DREB, 2 OREB', athlete: { id: 'giddey', displayName: 'Josh Giddey', shortName: 'J. Giddey', position: { abbreviation: 'G' } } }] },
          { name: 'points', displayName: 'Points', leaders: [{ displayValue: '41', mainStat: { value: '41', label: 'PTS' }, summary: '16/28 FG, 4/5 FT', athlete: { id: 'buzelis', displayName: 'Matas Buzelis', shortName: 'M. Buzelis', position: { abbreviation: 'F' } } }] },
        ],
      },
      { team: { id: '9', abbreviation: 'GS' }, leaders: [{ name: 'assists', displayName: 'Assists', leaders: [{ displayValue: '7', mainStat: { value: '7', label: 'AST' }, summary: '2 TO, 27 MIN', athlete: { id: 'podz', displayName: 'Brandin Podziemski', shortName: 'B. Podziemski' } }] }] },
    ],
    boxscore: {
      teams: [
        { team: { id: '9' }, statistics: [{ name: 'fieldGoalsMade-fieldGoalsAttempted', displayValue: '50-112' }, { name: 'totalRebounds', displayValue: '64' }, { name: 'fieldGoalPct', displayValue: '45' }] },
        { team: { id: '4' }, statistics: [{ name: 'fieldGoalsMade-fieldGoalsAttempted', displayValue: '52-110' }, { name: 'totalRebounds', displayValue: '58' }] },
      ],
      players: [
        {
          team: { id: '9' },
          statistics: [
            {
              labels: ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST'],
              totals: ['', '124', '50-112', '15-47', '15-18', '64', '34'],
              athletes: [
                { starter: true, didNotPlay: false, reason: "COACH'S DECISION", athlete: athlete('green', 'Draymond Green', 'D. Green', 'F'), stats: ['30', '12', '4-9', '2-5', '2-2', '6', '5'] },
                { starter: false, didNotPlay: false, athlete: athlete('podz', 'Brandin Podziemski', 'B. Podziemski', 'G'), stats: ['27', '9', '3-8', '1-4', '2-2', '4', '7'] },
                { starter: false, didNotPlay: true, reason: 'LEFT ANKLE SPRAIN', athlete: athlete('hurt', 'Hurt Player', 'H. Player', 'G'), stats: [] },
              ],
            },
          ],
        },
        {
          team: { id: '4' },
          statistics: [
            { labels: ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST'], totals: ['', '130'], athletes: [{ starter: true, didNotPlay: false, athlete: athlete('buzelis', 'Matas Buzelis', 'M. Buzelis', 'F'), stats: ['42', '41', '16-28', '5-9', '4-5', '7', '2'] }] },
          ],
        },
      ],
    },
    plays: [
      { id: 'j', type: { text: 'Jumpball' }, text: 'Matas Buzelis vs. Al Horford', period: { number: 1 }, clock: { displayValue: '12:00' }, team: { id: '9' }, participants: [] },
      { id: 'ft', type: { text: 'Free Throw - 1 of 2' }, text: 'Brandin Podziemski makes free throw 1 of 2', period: { number: 1 }, clock: { displayValue: '11:20' }, team: { id: '9' }, shootingPlay: true, scoringPlay: true, scoreValue: 1, awayScore: 0, homeScore: 1, coordinate: SENTINEL, participants: [{ athlete: { id: 'podz' } }] },
      { id: 'm3', type: { text: 'Jump Shot' }, text: 'Draymond Green makes 26-foot three point jumper (Brandin Podziemski assists)', period: { number: 1 }, clock: { displayValue: '10:58' }, team: { id: '9' }, shootingPlay: true, scoringPlay: true, scoreValue: 3, awayScore: 0, homeScore: 4, coordinate: { x: 33, y: 25 }, participants: [{ athlete: { id: 'green' } }, { athlete: { id: 'podz' } }] },
      { id: 'miss', type: { text: 'Pullup Jump Shot' }, text: 'Matas Buzelis misses 15-foot pullup jump shot', period: { number: 1 }, clock: { displayValue: '10:40' }, team: { id: '4' }, shootingPlay: true, scoringPlay: false, coordinate: { x: 12, y: 9 }, participants: [{ athlete: { id: 'buzelis' } }] },
      // Not seen in the measured game (0 of 36 free throws had a real spot), but a free
      // throw with an in-court coordinate must still stay off the chart.
      { id: 'ftcourt', type: { text: 'Free Throw - 2 of 2' }, text: 'Matas Buzelis makes free throw 2 of 2', period: { number: 1 }, clock: { displayValue: '10:30' }, team: { id: '4' }, shootingPlay: true, scoringPlay: true, scoreValue: 1, coordinate: { x: 25, y: 15 }, participants: [{ athlete: { id: 'buzelis' } }] },
      // An out-of-bounds spot that is not the sentinel must also be rejected.
      { id: 'oob', type: { text: 'Jump Shot' }, text: 'Draymond Green misses jump shot', period: { number: 1 }, clock: { displayValue: '10:20' }, team: { id: '9' }, shootingPlay: true, scoringPlay: false, coordinate: { x: 60, y: 10 }, participants: [{ athlete: { id: 'green' } }] },
      { id: 'sub', type: { text: 'Substitution' }, text: 'Kevon Looney enters the game for Draymond Green', period: { number: 5 }, clock: { displayValue: '0:40' }, team: { id: '9' }, participants: [{ athlete: { id: 'x' } }] },
      { id: 'win', type: { text: 'Driving Layup Shot' }, text: 'Matas Buzelis makes driving layup', period: { number: 5 }, clock: { displayValue: '0:21' }, team: { id: '4' }, shootingPlay: true, scoringPlay: true, scoreValue: 2, awayScore: 130, homeScore: 124, coordinate: { x: 24, y: 1 }, participants: [{ athlete: { id: 'buzelis' } }] },
      { id: 'ep', type: { text: 'End Period' }, text: 'End of the 1st Overtime', period: { number: 5 }, clock: { displayValue: '0.0' } },
      { id: 'eg', type: { text: 'End Game' }, text: 'End of Game', period: { number: 5 }, clock: { displayValue: '0.0' } },
    ],
    winprobability: [{ homeWinPercentage: 0.4 }, { homeWinPercentage: 0, tiePercentage: 0 }],
    gameInfo: { venue: { fullName: 'Chase Center', address: { city: 'San Francisco', state: 'CA' } }, attendance: 18064 },
  }
}

const opts = { sport: 'NBA', gameId: '401810798', fetchedAt: '2026-09-13T20:00:00.000Z' }

describe('trimEspnGameSummary — NBA', () => {
  it('reads the header with the overtime line score, and has no drive', () => {
    const d = trimEspnGameSummary(rawNba(), opts)!
    expect(d.home).toMatchObject({ abbrev: 'GS', score: 124, linescores: [30, 21, 32, 35, 6] })
    expect(d.away).toMatchObject({ abbrev: 'CHI', score: 130 })
    expect(d.drive).toBeNull()
    expect(d.situation).toBeNull()
    expect(d.basketball).not.toBeNull()
  })

  it('orders basketball leaders points, rebounds, assists', () => {
    const d = trimEspnGameSummary(rawNba(), opts)!
    expect(d.leaders.away.map((l) => l.category)).toEqual(['points', 'rebounds'])
    expect(d.leaders.away[0]).toMatchObject({ label: 'Points', mainValue: '41', summary: '16/28 FG, 4/5 FT' })
  })

  it('drops substitutions from the stored play list', () => {
    const plays = trimEspnGameSummary(rawNba(), opts)!.basketball!.plays
    expect(plays.map((p) => p.id)).not.toContain('sub')
    expect(plays.map((p) => p.id)).toContain('win')
  })

  it('keeps shots with a real court spot and drops free throws and the sentinel coordinate', () => {
    const shots = trimEspnGameSummary(rawNba(), opts)!.basketball!.shots
    expect(shots.map((s) => s.id)).toEqual(['m3', 'miss', 'win'])
    expect(shots.find((s) => s.id === 'm3')).toMatchObject({ x: 33, y: 25, made: true, value: 3, teamId: '9', athleteId: 'green' })
    expect(shots.find((s) => s.id === 'miss')?.made).toBe(false)
  })

  it('last play skips End Game / End Period, and its player cards come from the play\'s own ids', () => {
    const d = trimEspnGameSummary(rawNba(), opts)!
    expect(d.lastPlay?.text).toBe('Matas Buzelis makes driving layup')
    expect(d.lastPlayAthleteIds).toEqual(['buzelis'])
    expect(d.players.buzelis?.[0]).toMatchObject({ group: 'basketball', labels: ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST'] })
  })

  it('box score: starters, bench and did-not-play with ESPN\'s reason, per side', () => {
    const box = trimEspnGameSummary(rawNba(), opts)!.basketball!.box
    expect(box.home?.teamId).toBe('9')
    expect(box.away?.teamId).toBe('4')
    const green = box.home!.players.find((p) => p.athleteId === 'green')!
    expect(green).toMatchObject({ starter: true, didNotPlay: false })
    const hurt = box.home!.players.find((p) => p.athleteId === 'hurt')!
    expect(hurt).toMatchObject({ didNotPlay: true, reason: 'LEFT ANKLE SPRAIN' })
    expect(box.home!.totals[1]).toBe('124')
  })

  it('uses basketball team stats: made/attempted shown as 50/112 and shared by rate', () => {
    const stats = trimEspnGameSummary(rawNba(), opts)!.teamStats
    const fg = stats.find((s) => s.key === 'fieldGoalsMade-fieldGoalsAttempted')!
    expect(fg).toMatchObject({ label: 'Field Goals', home: '50/112', away: '52/110' })
    expect(fg.homeShare).toBeCloseTo((50 / 112) / (50 / 112 + 52 / 110))
    expect(stats.map((s) => s.key)).not.toContain('totalYards')
  })

  it('a football summary has no basketball block', () => {
    const football = { ...rawNba(), plays: undefined, drives: { previous: [] } }
    expect(trimEspnGameSummary(football, { ...opts, sport: 'NFL' })!.basketball).toBeNull()
  })

  it('NBA is a covered game-view sport', () => {
    expect(GAME_VIEW_SPORTS).toContain('NBA')
  })
})
