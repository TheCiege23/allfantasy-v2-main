/**
 * A hand-cut ESPN men's college basketball summary for the game-view tests. Field
 * names and value shapes are the ones measured on 2026-09-13 against last season's
 * UConn vs Michigan (401856600), Oklahoma vs Baylor (401858383) and Illinois @ UCLA
 * (401825532, Final/OT): periods named "1st Half" / "2nd Half" / "OT", free throws —
 * makes and misses — typed "MadeFreeThrow" with a real spot at the rim (25, 0) and
 * `pointsAttempted: 1`, a single unnamed box-score group with no `reason` on DNPs,
 * leaders with `mainStat`, and NBA-named team stats.
 *
 * UCLA home (26), Illinois away (356). The plays are a short, consistent script.
 */

const LABELS = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF']

const athlete = (id: string, displayName: string, shortName: string, position: string) => ({
  id,
  displayName,
  shortName,
  headshot: { href: `https://a.espncdn.com/i/headshots/mens-college-basketball/players/full/${id}.png` },
  jersey: '1',
  position: { abbreviation: position },
})

const period = (number: number) => ({ number, displayValue: number === 1 ? '1st Half' : number === 2 ? '2nd Half' : 'OT' })

export function rawNcaab() {
  return {
    header: {
      competitions: [
        {
          neutralSite: false,
          status: { type: { state: 'post', detail: 'Final/OT', shortDetail: 'Final/OT', altDetail: 'OT' } },
          competitors: [
            { homeAway: 'home', score: '95', team: { id: '26', abbreviation: 'UCLA', displayDisplayName: 'UCLA', displayName: 'UCLA Bruins', color: '2774ae', alternateColor: 'f2a900' }, linescores: ['43', '43', '9'].map((displayValue) => ({ displayValue })) },
            { homeAway: 'away', score: '94', curatedRank: { current: 10 }, team: { id: '356', abbreviation: 'ILL', displayName: 'Illinois Fighting Illini', color: 'ff5f05', alternateColor: '13294b' }, linescores: ['50', '36', '8'].map((displayValue) => ({ displayValue })) },
          ],
        },
      ],
    },
    leaders: [
      {
        team: { id: '356' },
        leaders: [
          { name: 'points', displayName: 'Points', leaders: [{ displayValue: '19', value: 19, mainStat: { value: '19', label: 'PTS' }, summary: '5/15 FG, 8/8 FT', athlete: athlete('wagler', 'Keaton Wagler', 'K. Wagler', 'G') }] },
          { name: 'assists', displayName: 'Assists', leaders: [{ displayValue: '6', value: 6, mainStat: { value: '6', label: 'AST' }, summary: '2 TO, 39 MIN', athlete: athlete('boswell', 'Kylan Boswell', 'K. Boswell', 'G') }] },
          { name: 'rebounds', displayName: 'Rebounds', leaders: [{ displayValue: '8', value: 8, mainStat: { value: '8', label: 'REB' }, summary: '2 DREB, 6 OREB', athlete: athlete('ivisic', 'Tomislav Ivisic', 'T. Ivisic', 'C') }] },
        ],
      },
    ],
    boxscore: {
      teams: [
        { team: { id: '356' }, statistics: [{ name: 'fieldGoalsMade-fieldGoalsAttempted', displayValue: '28-69' }, { name: 'totalRebounds', displayValue: '43' }] },
        { team: { id: '26' }, statistics: [{ name: 'fieldGoalsMade-fieldGoalsAttempted', displayValue: '34-67' }, { name: 'totalRebounds', displayValue: '27' }] },
      ],
      players: [
        {
          team: { id: '356' },
          statistics: [
            {
              labels: LABELS,
              totals: ['', '94', '28-69', '13-42', '25-31', '43', '19', '9', '2', '5', '20', '23', '18'],
              athletes: [
                { active: true, starter: true, didNotPlay: false, ejected: false, athlete: athlete('wagler', 'Keaton Wagler', 'K. Wagler', 'G'), stats: ['39', '19', '5-15', '1-7', '8-8', '4', '3', '2', '0', '0', '1', '3', '2'] },
                { active: true, starter: true, didNotPlay: false, ejected: false, athlete: athlete('boswell', 'Kylan Boswell', 'K. Boswell', 'G'), stats: ['39', '12', '4-11', '2-6', '2-2', '3', '6', '2', '1', '0', '0', '3', '3'] },
                { active: true, starter: false, didNotPlay: false, ejected: false, athlete: athlete('ivisic', 'Tomislav Ivisic', 'T. Ivisic', 'C'), stats: ['22', '10', '3-8', '2-5', '2-2', '8', '1', '1', '0', '1', '6', '2', '4'] },
                { active: false, starter: false, didNotPlay: true, ejected: false, athlete: athlete('walkon', 'Walk On', 'W. On', 'G'), stats: [] },
              ],
            },
          ],
        },
        {
          team: { id: '26' },
          statistics: [
            {
              labels: LABELS,
              totals: ['', '95', '34-67', '11-28', '16-19', '27', '21', '5', '5', '1', '8', '19', '21'],
              athletes: [
                { active: true, starter: true, didNotPlay: false, ejected: false, athlete: athlete('dent', 'Donovan Dent', 'D. Dent', 'G'), stats: ['42', '20', '8-13', '3-5', '1-2', '6', '15', '0', '1', '0', '2', '4', '2'] },
              ],
            },
          ],
        },
      ],
    },
    plays: [
      { id: 'j', type: { text: 'Jumpball' }, text: 'Jump Ball won by Illinois', period: period(1), clock: { displayValue: '20:00' }, team: { id: '356' }, participants: [] },
      { id: 'ft1', type: { text: 'MadeFreeThrow' }, text: 'Tomislav Ivisic makes free throw 1 of 2', period: period(1), clock: { displayValue: '18:40' }, team: { id: '356' }, shootingPlay: true, scoringPlay: true, scoreValue: 1, pointsAttempted: 1, awayScore: 1, homeScore: 0, coordinate: { x: 25, y: 0 }, participants: [{ athlete: { id: 'ivisic' } }] },
      // A MISSED free throw is also typed "MadeFreeThrow".
      { id: 'ftmiss', type: { text: 'MadeFreeThrow' }, text: 'Tomislav Ivisic misses free throw 2 of 2', period: period(1), clock: { displayValue: '18:40' }, team: { id: '356' }, shootingPlay: true, scoringPlay: false, scoreValue: 0, pointsAttempted: 1, awayScore: 1, homeScore: 0, coordinate: { x: 25, y: 0 }, participants: [{ athlete: { id: 'ivisic' } }] },
      { id: 'three', type: { text: 'JumpShot' }, text: 'Keaton Wagler makes 23-foot three point jumper', period: period(1), clock: { displayValue: '17:10' }, team: { id: '356' }, shootingPlay: true, scoringPlay: true, scoreValue: 3, pointsAttempted: 3, awayScore: 4, homeScore: 0, coordinate: { x: 47, y: 6 }, participants: [{ athlete: { id: 'wagler' } }] },
      { id: 'miss2', type: { text: 'JumpShot' }, text: 'Kylan Boswell misses 12-foot pullup jump shot', period: period(2), clock: { displayValue: '11:05' }, team: { id: '356' }, shootingPlay: true, scoringPlay: false, scoreValue: 0, pointsAttempted: 2, awayScore: 60, homeScore: 58, coordinate: { x: 19, y: 11 }, participants: [{ athlete: { id: 'boswell' } }] },
      { id: 'sub', type: { text: 'Substitution' }, text: 'Brandon Williams subbing in for UCLA', period: period(2), clock: { displayValue: '8:00' }, team: { id: '26' }, participants: [{ athlete: { id: 'x' } }] },
      { id: 'ot', type: { text: 'LayUpShot' }, text: 'Donovan Dent makes layup', period: period(3), clock: { displayValue: '0:04' }, team: { id: '26' }, shootingPlay: true, scoringPlay: true, scoreValue: 2, pointsAttempted: 2, awayScore: 94, homeScore: 95, coordinate: { x: 25, y: 1 }, participants: [{ athlete: { id: 'dent' } }] },
      { id: 'chal', type: { text: "Coach's Challenge (Stands)" }, text: "Coach's Challenge (Stands)", period: period(3), clock: { displayValue: '0:04' }, team: { id: '356' }, participants: [] },
      { id: 'ep', type: { text: 'End Period' }, text: 'End of 1st OT', period: period(3), clock: { displayValue: '0:00' } },
      { id: 'eg', type: { text: 'End Game' }, text: 'End of Game', period: period(3), clock: { displayValue: '0:00' } },
    ],
    winprobability: [{ homeWinPercentage: 0.51, tiePercentage: 0, playId: 'ot' }],
    gameInfo: { venue: { fullName: 'Pauley Pavilion', address: { city: 'Los Angeles', state: 'CA' } }, attendance: 10036 },
  }
}

export const NCAAB_OPTS = { sport: 'NCAAB', gameId: '401825532', fetchedAt: '2026-09-13T20:00:00.000Z' }
