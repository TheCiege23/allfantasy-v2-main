/**
 * A hand-cut ESPN MLB summary for the game-view tests. Field names and value
 * shapes are the ones measured on 2026-09-13 — COL @ DET (401816920, final) and
 * KC @ BOS (401816922, live): pitch-level plays keyed by `atBatId`, `team` as a
 * bare id string on at-bat plays but `{ id }` on inning markers, the batted-ball
 * spot on the in-play pitch, `resultCount` for the count after a pitch, box-score
 * groups carrying `type` instead of `name`, grouped team stats, and a live
 * `situation` whose batter/pitcher/runners are `{ playerId }`.
 *
 * The plays are a short, self-consistent script — not a copy of either game.
 */

export const IDS = {
  jobe: '4872647',
  hughes: '4634930',
  mccarthy: '41197',
  beck: '4431452',
  amador: '4417208',
  mcgonigle: '5149072',
  greene: '4683384',
  peck: '4990055',
} as const

type Play = Record<string, unknown>

const period = (type: 'Top' | 'Bottom', number: number) => ({ type, number, displayValue: `${number}st Inning` })
const who = (pitcher: string, batter: string) => [
  { type: 'pitcher', athlete: { id: pitcher } },
  { type: 'batter', athlete: { id: batter } },
]

function atBat(ab: string, half: 'Top' | 'Bottom', inning: number, battingTeam: string, pitcher: string, batter: string) {
  const base = { atBatId: ab, period: period(half, inning), participants: who(pitcher, batter) }
  return {
    start: (): Play => ({
      ...base,
      id: `${ab}010001`,
      summaryType: 'A',
      type: { type: 'start-batterpitcher', text: 'Start Batter/Pitcher' },
      text: 'pitches to',
      team: battingTeam,
    }),
    pitch: (n: number, type: string, text: string, balls: number, strikes: number, extra: Play = {}): Play => ({
      ...base,
      id: `${ab}0${n}0037`,
      summaryType: 'P',
      type: { type, text },
      text: `Pitch ${n} : ${text}`,
      atBatPitchNumber: n,
      pitchType: { id: '17', text: 'Four-seam FB', abbreviation: 'FF' },
      pitchVelocity: 95,
      pitchCoordinate: { x: 110, y: 170 },
      resultCount: { balls, strikes },
      ...extra,
    }),
    result: (text: string, extra: Play = {}): Play => ({
      ...base,
      id: `${ab}990057`,
      summaryType: 'N',
      type: { type: 'play-result', text: 'Play Result' },
      text,
      team: battingTeam,
      scoringPlay: false,
      ...extra,
    }),
    event: (type: string, typeText: string, text: string): Play => ({
      ...base,
      id: `${ab}${type.length}0000`,
      type: { type, text: typeText },
      text,
    }),
    end: (extra: Play = {}): Play => ({
      ...base,
      id: `${ab}999999`,
      type: { type: 'end-batterpitcher', text: 'End Batter/Pitcher' },
      ...extra,
    }),
  }
}

const BATTING_LABELS = ['H-AB', 'AB', 'R', 'H', 'RBI', 'HR', 'BB', 'K', '#P', 'AVG', 'OBP', 'SLG']
const PITCHING_LABELS = ['IP', 'H', 'R', 'ER', 'BB', 'K', 'HR', 'PC-ST', 'ERA', 'PC']

const batter = (id: string, displayName: string, shortName: string, pos: string, batOrder: number, starter: boolean, stats: string[]) => ({
  active: true,
  athlete: { id, displayName, shortName, position: { abbreviation: pos }, headshot: { href: `https://a.espncdn.com/i/headshots/mlb/players/full/${id}.png` } },
  starter,
  batOrder,
  position: { abbreviation: pos },
  stats,
})
const pitcher = (id: string, displayName: string, shortName: string, stats: string[], decision?: string) => ({
  active: true,
  athlete: { id, displayName, shortName, position: { abbreviation: 'SP' } },
  starter: true,
  stats,
  ...(decision ? { notes: [{ type: 'pitchingDecision', text: decision }] } : {}),
})

export function rawMlb({ live = false }: { live?: boolean } = {}) {
  const ab1 = atBat('4018169200001', 'Top', 1, '27', IDS.jobe, IDS.mccarthy)
  const ab2 = atBat('4018169200002', 'Top', 1, '27', IDS.jobe, IDS.amador)
  const ab3 = atBat('4018169200101', 'Bottom', 1, '6', IDS.hughes, IDS.mcgonigle)
  const ab4 = atBat('4018169200102', 'Bottom', 1, '6', IDS.hughes, IDS.greene)

  const plays: Play[] = [
    {
      id: '4018169200000000059',
      atBatId: '4018169200001',
      summaryType: 'I',
      type: { type: 'start-inning', text: 'Start Inning' },
      text: 'Top of the 1st inning',
      period: period('Top', 1),
      team: { id: '27' },
    },
    // Strikeout after a foul. The foul AND the end marker carry a coordinate; neither is a ball in play.
    ab1.start(),
    ab1.pitch(1, 'strike-looking', 'Strike 1 Looking', 0, 1, { pitchCoordinate: { x: 135, y: 195 } }),
    ab1.pitch(2, 'foul-ball', 'Strike 2 Foul', 0, 2, { hitCoordinate: { x: 40, y: 98 }, trajectory: 'L' }),
    ab1.pitch(3, 'strike-swinging', 'Strike 3 Swinging', 0, 3, { pitchCoordinate: { x: 74, y: 200 } }),
    ab1.result('McCarthy struck out swinging.', { outs: 1, awayScore: 0, homeScore: 0 }),
    ab1.end({ hitCoordinate: { x: 40, y: 98 } }),
    // Home run — the measured (242, 87) spot that ESPN's text calls 394 feet.
    ab2.start(),
    ab2.pitch(1, 'ball', 'Ball 1', 1, 0, { pitchCoordinate: { x: 60, y: 120 } }),
    ab2.pitch(2, 'home-run', 'Home Run', 1, 0, { hitCoordinate: { x: 242, y: 87 }, trajectory: 'F' }),
    ab2.result('Amador homered to right (394 feet).', { summaryType: 'S', scoringPlay: true, awayScore: 1, homeScore: 0, outs: 1 }),
    ab2.end(),
    // A substitution logged AFTER the end marker, under the same at-bat id. Not seen in
    // the games measured; the end-marker bound in mapBaseball guards it.
    ab2.result('Beck in left field.', { id: '4018169200002990058' }),
    {
      id: '4018169200004000060',
      atBatId: '4018169200002',
      type: { type: 'end-inning', text: 'End Inning' },
      text: 'Middle of the 1st inning',
      period: { type: 'Mid', number: 1, displayValue: '1st Inning' },
      team: { id: '27' },
    },
    {
      id: '4018169200100000059',
      atBatId: '4018169200101',
      summaryType: 'I',
      type: { type: 'start-inning', text: 'Start Inning' },
      text: 'Bottom of the 1st inning',
      period: period('Bottom', 1),
      team: { id: '6' },
    },
    // A steal inside the at-bat, then the batter's own triple: the at-bat's result is the LAST one.
    ab3.start(),
    ab3.pitch(1, 'ball', 'Ball 1', 1, 0),
    ab3.event('stolen-base', 'Stolen Base', 'Peck stole second.'),
    ab3.result('Peck stole second.', { id: '4018169200101990058', outs: 0, awayScore: 1, homeScore: 0 }),
    ab3.pitch(2, 'triple', 'Triple', 1, 0, { hitCoordinate: { x: 130, y: 60 }, trajectory: 'F' }),
    ab3.result('McGonigle tripled to center, Peck scored.', { summaryType: 'S', scoringPlay: true, awayScore: 1, homeScore: 1, outs: 0 }),
    ab3.end(),
  ]
  if (live) {
    plays.push(
      // A substitution before the first pitch, and a wild pitch after the latest one:
      // neither is Greene's result — he is still up.
      ab4.result('Keith at third base.', { id: '4018169200102990050' }),
      ab4.start(),
      ab4.pitch(1, 'strike-swinging', 'Strike 1 Swinging', 0, 1, { pitchCoordinate: { x: 111, y: 144 } }),
      ab4.pitch(2, 'ball', 'Ball 1', 1, 1, { pitchCoordinate: { x: 182, y: 230 } }),
      ab4.event('wild-pitch', 'Wild Pitch', 'Wild pitch by Hughes.'),
      ab4.result('Hughes threw a wild pitch.', { id: '4018169200102990058' }),
    )
  }

  return {
    header: {
      competitions: [
        {
          status: live
            ? { period: 1, displayClock: '0:00', type: { state: 'in', shortDetail: 'Bot 1st' } }
            : {
                type: { state: 'post', shortDetail: 'Final' },
                featuredAthletes: [
                  { name: 'winningPitcher', displayName: 'Winning Pitcher', playerId: 4872647, athlete: { id: IDS.jobe, displayName: 'Jackson Jobe' }, team: { id: '6' } },
                  { name: 'losingPitcher', displayName: 'Losing Pitcher', playerId: 4634930, athlete: { id: IDS.hughes, displayName: 'Gabriel Hughes' }, team: { id: '27' } },
                ],
              },
          competitors: [
            { homeAway: 'home', score: '1', hits: 1, errors: 1, team: { id: '6', abbreviation: 'DET', displayName: 'Detroit Tigers', color: '0a2240', alternateColor: 'ff4713' }, linescores: [{ displayValue: '1', hits: 1, errors: 1 }] },
            { homeAway: 'away', score: '1', hits: 1, errors: 0, team: { id: '27', abbreviation: 'COL', displayName: 'Colorado Rockies', color: '33006f', alternateColor: '000000' }, linescores: [{ displayValue: '1', hits: 1, errors: 0 }] },
          ],
        },
      ],
    },
    ...(live
      ? {
          situation: {
            lastPlay: { id: '4018169200102020037' },
            balls: 1,
            strikes: 1,
            outs: 0,
            pitcher: { playerId: Number(IDS.hughes) },
            batter: { playerId: Number(IDS.greene) },
            onThird: { playerId: Number(IDS.mcgonigle) },
          },
        }
      : {}),
    boxscore: {
      teams: [
        {
          team: { id: '6' },
          statistics: [
            { name: 'batting', stats: [{ name: 'hits', displayValue: '8' }, { name: 'homeRuns', displayValue: '2' }] },
            { name: 'fielding', stats: [{ name: 'errors', displayValue: '1' }] },
          ],
        },
        {
          team: { id: '27' },
          statistics: [
            { name: 'batting', stats: [{ name: 'hits', displayValue: '5' }, { name: 'homeRuns', displayValue: '1' }] },
            { name: 'fielding', stats: [{ name: 'errors', displayValue: '0' }] },
          ],
        },
      ],
      players: [
        {
          team: { id: '27' },
          statistics: [
            {
              type: 'batting',
              labels: BATTING_LABELS,
              athletes: [
                batter(IDS.mccarthy, 'Jake McCarthy', 'J. McCarthy', 'CF', 1, true, ['0-1', '1', '0', '0', '0', '0', '0', '1', '3', '.295', '.340', '.481']),
                batter(IDS.beck, 'Jordan Beck', 'J. Beck', 'LF', 1, false, ['0-0', '0', '0', '0', '0', '0', '0', '0', '0', '.250', '.310', '.420']),
                batter(IDS.amador, 'Adael Amador', 'A. Amador', '2B', 2, true, ['1-1', '1', '1', '1', '1', '1', '0', '0', '2', '.240', '.300', '.410']),
              ],
              totals: ['1-2', '2', '1', '1', '1', '1', '0', '1', '5', '', '', ''],
            },
            { type: 'pitching', labels: PITCHING_LABELS, athletes: [pitcher(IDS.hughes, 'Gabriel Hughes', 'G. Hughes', ['0.0', '1', '1', '1', '1', '0', '0', '2-1', '6.37', '2'], 'L, 0-8')], totals: ['0.0', '1', '1', '1', '1', '0', '0', '2-1', '', '2'] },
          ],
        },
        {
          team: { id: '6' },
          statistics: [
            {
              type: 'batting',
              labels: BATTING_LABELS,
              athletes: [
                batter(IDS.mcgonigle, 'Kevin McGonigle', 'K. McGonigle', 'DH', 1, true, ['1-1', '1', '0', '1', '1', '0', '0', '0', '2', '.270', '.330', '.450']),
                batter(IDS.greene, 'Riley Greene', 'R. Greene', 'LF', 2, true, ['0-0', '0', '0', '0', '0', '0', '0', '0', '2', '.280', '.350', '.500']),
                batter(IDS.peck, 'Jace Peck', 'J. Peck', 'SS', 9, true, ['0-0', '0', '1', '0', '0', '0', '1', '0', '5', '.220', '.290', '.330']),
              ],
              totals: ['1-1', '1', '1', '1', '1', '0', '1', '0', '9', '', '', ''],
            },
            { type: 'pitching', labels: PITCHING_LABELS, athletes: [pitcher(IDS.jobe, 'Jackson Jobe', 'J. Jobe', ['6.1', '3', '1', '1', '1', '8', '1', '87-56', '3.89', '87'], 'W, 2-2')], totals: ['6.1', '3', '1', '1', '1', '8', '1', '87-56', '', '87'] },
          ],
        },
      ],
    },
    plays,
    winprobability: [{ homeWinPercentage: 0.62, tiePercentage: 0, playId: '4018169200101990057' }],
    gameInfo: { venue: { fullName: 'Comerica Park', address: { city: 'Detroit', state: 'Michigan' } }, attendance: 22726 },
  }
}

export const MLB_OPTS = { sport: 'MLB', gameId: '401816920', fetchedAt: '2026-09-13T20:00:00.000Z' }
