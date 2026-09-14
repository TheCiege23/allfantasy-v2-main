/**
 * ESPN NBA scoreboard values, copied from the live feed.
 *
 * In-game: DET @ CHA, 2026-04-10, Final — CHA 100 (30-35-25-10), DET 118
 * (36-32-25-25). Pre-game: a scheduled WNBA game read 2026-09-13, whose
 * competitors carry SEASON averages and totals in the same fields.
 */

const athlete = (displayName: string, shortName: string, id: string, position: string) => ({
  displayName,
  shortName,
  headshot: `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`,
  position: { abbreviation: position },
})

const cat = (name: string, shortDisplayName: string, displayValue: string, teamId: string, a: ReturnType<typeof athlete>) => ({
  name,
  shortDisplayName,
  leaders: [{ displayValue, team: { id: teamId }, athlete: a }],
})

const BALL = athlete('LaMelo Ball', 'L. Ball', '4432816', 'G')
const BRIDGES = athlete('Miles Bridges', 'M. Bridges', '4066383', 'F')
const DUREN = athlete('Jalen Duren', 'J. Duren', '4433621', 'C')
const CUNNINGHAM = athlete('Cade Cunningham', 'C. Cunningham', '4432166', 'G')

export const CHA_LEADERS = [
  cat('points', 'Pts', '27', '30', BALL),
  cat('rebounds', 'Reb', '8', '30', BRIDGES),
  cat('assists', 'Ast', '8', '30', BALL),
  cat('rating', 'RAT', '27 PTS, 8 AST', '30', BALL),
]

export const DET_LEADERS = [
  cat('points', 'Pts', '20', '8', DUREN),
  cat('rebounds', 'Reb', '9', '8', DUREN),
  cat('assists', 'Ast', '7', '8', CUNNINGHAM),
  cat('rating', 'RAT', '20 PTS, 9 REB', '8', DUREN),
]

const stats = (rows: Record<string, string>) => Object.entries(rows).map(([name, displayValue]) => ({ name, displayValue }))

export const CHA_STATS = stats({
  rebounds: '41',
  assists: '16',
  fieldGoalsAttempted: '88',
  fieldGoalsMade: '34',
  fieldGoalPct: '38.6',
  freeThrowPct: '82.6',
  freeThrowsAttempted: '23',
  freeThrowsMade: '19',
  points: '100',
  threePointPct: '27.7',
  threePointFieldGoalsAttempted: '47',
  threePointFieldGoalsMade: '13',
  threePointFieldGoalPct: '27.7',
})

export const DET_STATS = stats({
  fieldGoalsAttempted: '89',
  fieldGoalsMade: '45',
  fieldGoalPct: '50.6',
  freeThrowPct: '73.1',
  freeThrowsAttempted: '26',
  freeThrowsMade: '19',
  threePointFieldGoalsAttempted: '27',
  threePointFieldGoalsMade: '9',
  threePointFieldGoalPct: '33.3',
})

/** What a scheduled game's competitor sends in the same two fields. */
export const PRE_GAME_LEADERS = [
  cat('pointsPerGame', 'PTS', '19.3', '20', athlete('Allisha Gray', 'A. Gray', '1', 'G')),
  cat('reboundsPerGame', 'REB', '12.4', '20', athlete('Angel Reese', 'A. Reese', '2', 'F')),
  cat('assistsPerGame', 'AST', '7.4', '20', athlete('Jordin Canada', 'J. Canada', '3', 'G')),
  cat('rating', 'RAT', '16.1 PPG, 12.4 RPG, 2.8 APG, 1.8 SPG, 0.7 BPG', '20', athlete('Angel Reese', 'A. Reese', '2', 'F')),
]

export const PRE_GAME_STATS = stats({
  fieldGoalsAttempted: '2855',
  fieldGoalsMade: '1254',
  fieldGoalPct: '43.9',
  freeThrowPct: '78.7',
  freeThrowsAttempted: '979',
  freeThrowsMade: '770',
  threePointFieldGoalsAttempted: '1092',
  threePointFieldGoalsMade: '354',
  threePointFieldGoalPct: '32.4',
})

const lines = (values: number[]) => values.map((value) => ({ value, displayValue: String(value) }))

/** One scoreboard event, in the state asked for. */
export function nbaScoreboardEvent(state: 'pre' | 'in' | 'post', id = '401811026') {
  const pre = state === 'pre'
  return {
    id,
    date: '2026-04-10T23:00Z',
    season: { year: 2026 },
    competitions: [
      {
        startDate: '2026-04-10T23:00Z',
        status: {
          type: {
            name: pre ? 'STATUS_SCHEDULED' : state === 'in' ? 'STATUS_IN_PROGRESS' : 'STATUS_FINAL',
            state,
            shortDetail: pre ? '4/10 - 7:00 PM EDT' : state === 'in' ? '5:42 - 3rd' : 'Final',
            completed: state === 'post',
          },
          period: pre ? 0 : 4,
          displayClock: '0.0',
        },
        competitors: [
          {
            homeAway: 'home',
            score: pre ? '0' : '100',
            team: { abbreviation: 'CHA', displayName: 'Charlotte Hornets', logo: '', id: '30' },
            linescores: pre ? undefined : lines([30, 35, 25, 10]),
            leaders: pre ? PRE_GAME_LEADERS : CHA_LEADERS,
            statistics: pre ? PRE_GAME_STATS : CHA_STATS,
          },
          {
            homeAway: 'away',
            score: pre ? '0' : '118',
            team: { abbreviation: 'DET', displayName: 'Detroit Pistons', logo: '', id: '8' },
            linescores: pre ? undefined : lines([36, 32, 25, 25]),
            leaders: pre ? PRE_GAME_LEADERS : DET_LEADERS,
            statistics: pre ? PRE_GAME_STATS : DET_STATS,
          },
        ],
      },
    ],
  }
}
