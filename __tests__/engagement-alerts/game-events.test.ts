import { describe, it, expect } from 'vitest'
import { gameStateAlerts, isCloseLateGame, gamePlayAlerts, topRankedGame, footballPlayKind, type GameObservation } from '@/lib/engagement-alerts/gameEvents'
import { allowsLeagueSms } from '@/lib/notifications/channelPolicy'
import type { LiveGameDetail } from '@/lib/live/espnGameSummary'

const game = (patch: Partial<GameObservation> = {}): GameObservation => ({ gameId: '12345', homeTeam: 'HOM', awayTeam: 'AWY', homeScore: 10, awayScore: 7, status: 'STATUS_IN_PROGRESS', statusDetail: 'Q2', period: 2, clock: '8:00', completed: false, ...patch })
const keys = (sport: string, prev: Partial<GameObservation>, next: Partial<GameObservation>, detail?: LiveGameDetail) => gameStateAlerts(sport, game(prev), game(next), detail).map(a => a.key)

describe('bootstrap and basics', () => {
  it('does not send historical events on bootstrap or invent missing scores', () => {
    expect(gameStateAlerts('NFL', null, game({ completed: true }))).toEqual([])
    expect(gameStateAlerts('NFL', game(), game({ homeScore: null, completed: true }))).toEqual([])
  })
  it('sends the final once, to the game audience, naming the winner', () => {
    const [final] = gameStateAlerts('NHL', game(), game({ completed: true, homeTeamFull: 'Home Club' }))
    expect(final).toMatchObject({ key: 'final', type: 'game_final', audience: 'game' })
    expect(final!.body).toContain('Home Club win 10–7')
    expect(gameStateAlerts('NBA', game({ completed: true }), game({ completed: true }))).toEqual([])
  })
  it('sends postseason checkpoints to everyone in the sport', () => {
    const [final] = gameStateAlerts('NBA', game({ eventName: 'East 1st Round - Game 3' }), game({ completed: true, eventName: 'East 1st Round - Game 3' }))
    expect(final!.audience).toBe('broad')
  })
})

describe('basketball: end of Q1, halftime, end of Q3, final — nothing per play', () => {
  it.each(['NBA', 'WNBA'])('%s sends Q1, half and Q3 but not Q4 checkpoints', sport => {
    expect(keys(sport, { period: 1 }, { period: 2, homeLinescores: [25, 2], awayLinescores: [20, 0] })).toEqual(['interval:1'])
    expect(keys(sport, { period: 2 }, { period: 2, status: 'STATUS_HALFTIME', clock: '0:00' })).toEqual(['halftime'])
    expect(keys(sport, { period: 3 }, { period: 4 })).toEqual(['interval:3'])
    expect(keys(sport, { period: 4, clock: '5:00', homeScore: 90, awayScore: 70 }, { period: 4, clock: '0:00', homeScore: 90, awayScore: 70, statusDetail: 'End of 4th' })).toEqual([])
  })
  it('reports the score at the end of the period from line scores when the poll arrives late', () => {
    const [a] = gameStateAlerts('NBA', game({ period: 2 }), game({ period: 3, homeScore: 65, awayScore: 60, homeLinescores: [25, 30, 10], awayLinescores: [20, 32, 8] }))
    expect(a).toMatchObject({ type: 'game_halftime', title: 'Halftime: AWY 52 — HOM 55' })
  })
  it('men’s college basketball plays halves: halftime only', () => {
    expect(keys('NCAAB', { period: 1 }, { period: 2 })).toEqual(['halftime'])
  })
  it('sends no per-play alerts for basketball', () => {
    for (const sport of ['NBA', 'WNBA', 'NCAAB']) {
      expect(gamePlayAlerts({ sport, drives: [], scoringPlays: [{ id: 'a', text: 'Three' }], basketball: { plays: [{ id: 'b', text: 'Dunk', scoring: true, athleteIds: [] }] } } as unknown as LiveGameDetail)).toEqual([])
    }
  })
  it('in the last 60 seconds, alerts on a tie, a lead change or a 1-4 point game — not a 6-point game', () => {
    const late = { period: 4, clock: '0:45' }
    expect(gameStateAlerts('NBA', game({ ...late, homeScore: 98, awayScore: 96 }), game({ ...late, homeScore: 98, awayScore: 98 }))[0]).toMatchObject({ type: 'game_close', audience: 'broad', title: expect.stringContaining('Tied') })
    expect(gameStateAlerts('NBA', game({ ...late, homeScore: 98, awayScore: 97 }), game({ ...late, homeScore: 98, awayScore: 100 }))[0]!.title).toContain('Lead change')
    expect(gameStateAlerts('NBA', game({ ...late, homeScore: 98, awayScore: 95 }), game({ ...late, homeScore: 98, awayScore: 96 }))[0]!.title).toContain('Crunch time')
    // The moment a game first turns close it is ONE "close game" alert, not that plus a crunch-time alert.
    expect(keys('NBA', { ...late, homeScore: 98, awayScore: 92 }, { ...late, homeScore: 98, awayScore: 94 })).toEqual(['close'])
    expect(keys('NBA', { ...late, homeScore: 100, awayScore: 92 }, { ...late, homeScore: 102, awayScore: 92 })).toEqual([])
    expect(keys('NBA', { period: 4, clock: '1:30', homeScore: 98, awayScore: 96 }, { period: 4, clock: '1:10', homeScore: 98, awayScore: 98 })).toEqual([])
  })
  it('names the player who scored the crunch-time basket, with a headshot', () => {
    const detail = { sport: 'NBA', players: { '9': [{ name: 'Jalen Brunson', headshot: 'https://img/9.png', group: 'basketball' }] }, basketball: { plays: [{ id: 'p', scoring: true, athleteIds: ['9'] }] } } as unknown as LiveGameDetail
    const [a] = gameStateAlerts('NBA', game({ period: 4, clock: '0:30', homeScore: 98, awayScore: 99 }), game({ period: 4, clock: '0:20', homeScore: 100, awayScore: 99 }), detail)
    expect(a!.body).toContain('Jalen Brunson scores')
    expect(a!.imageUrl).toBe('https://img/9.png')
  })
})

describe('close-game alerts for every sport carry the score and where to watch', () => {
  it.each([
    ['NFL', 4, '2:00', 8, true], ['NFL', 4, '2:30', 3, false], ['NFL', 4, '1:00', 9, false], ['NCAAF', 3, '1:00', 3, false],
    ['NBA', 4, '0:59', 4, true], ['NBA', 4, '1:30', 2, false], ['NCAAB', 2, '38.5', 2, true],
    ['NHL', 3, '1:00', 1, true], ['NHL', 3, '3:00', 1, false], ['MLB', 8, '', 1, true], ['MLB', 7, '', 1, false], ['SOCCER', 2, '85', 1, true],
  ])('applies %s late-game rules (period %s, %s left, %s apart → %s)', (sport, period, clock, gap, expected) => {
    expect(isCloseLateGame(sport as string, game({ period: period as number, clock: clock as string, homeScore: gap as number, awayScore: 0 }))).toBe(expected)
  })
  it('says where to watch', () => {
    const [a] = gameStateAlerts('NFL', game({ period: 4, clock: '3:00', homeScore: 20, awayScore: 17 }), game({ period: 4, clock: '1:55', homeScore: 20, awayScore: 17, broadcast: 'CBS', statusDetail: '1:55 - 4th' }))
    expect(a).toMatchObject({ key: 'close', audience: 'broad', severity: 'high' })
    expect(a!.body).toContain('Watch on CBS')
  })
})

describe('football checkpoints', () => {
  it('NFL sends halftime but not end-of-quarter updates', () => {
    expect(keys('NFL', { period: 1 }, { period: 2 })).toEqual([])
    expect(keys('NFL', { period: 2 }, { period: 3 })).toEqual(['halftime'])
    expect(keys('NFL', { period: 3 }, { period: 4 })).toEqual([])
  })
  it('college football sends end of Q1, halftime and end of Q3', () => {
    expect(keys('NCAAF', { period: 1 }, { period: 2 })).toEqual(['interval:1'])
    expect(keys('NCAAF', { period: 2 }, { period: 3 })).toEqual(['halftime'])
    expect(keys('NCAAF', { period: 3 }, { period: 4 })).toEqual(['interval:3'])
  })
  it('college games need a Top 25 team; pro games always pass', () => {
    expect(topRankedGame('NCAAF', { homeRank: 12, awayRank: null })).toBe(true)
    expect(topRankedGame('NCAAF', { homeRank: null, awayRank: null })).toBe(false)
    expect(topRankedGame('NCAAB', {})).toBe(false)
    expect(topRankedGame('NFL', {})).toBe(true)
  })
  it('shows the ranking in the score line', () => {
    const [a] = gameStateAlerts('NCAAF', game({ period: 1, homeRank: 5 }), game({ period: 2, homeRank: 5 }))
    expect(a!.title).toContain('#5 HOM')
  })
})

describe('hockey', () => {
  it('sends the end of the 1st and 2nd periods; the 3rd ends in a final or overtime', () => {
    expect(keys('NHL', { period: 1 }, { period: 2 })).toEqual(['interval:1'])
    expect(keys('NHL', { period: 2 }, { period: 3 })).toEqual(['interval:2'])
    expect(keys('NHL', { period: 3, clock: '5:00', homeScore: 2, awayScore: 2 }, { period: 4, clock: '5:00', homeScore: 2, awayScore: 2 })).toEqual(['overtime'])
  })
  const hockey = (plays: object[]) => ({ sport: 'NHL', drives: [], scoringPlays: [], home: { id: 'h', abbrev: 'HOM' }, away: { id: 'a', abbrev: 'AWY' },
    players: { s1: [{ name: 'Auston Matthews', headshot: 'https://img/s1.png', group: 'skaters' }], g1: [{ name: 'Igor Shesterkin', headshot: 'https://img/g1.png', group: 'goalies' }] },
    hockey: { plays, box: { home: { goalies: [] }, away: { goalies: [{ athleteId: 'g1' }] } } } } as unknown as LiveGameDetail)
  it('sends goals only in the last two minutes of a period in a game within two, with the scorer and headshot', () => {
    const early = { id: 'e', text: 'Goal', scoring: true, period: 2, clock: '10:00', homeScore: 1, awayScore: 0, athleteIds: ['s1'], teamId: 'h' }
    const late = { id: 'l', text: 'Goal', scoring: true, period: 3, clock: '1:30', homeScore: 2, awayScore: 2, athleteIds: ['s1'], teamId: 'h' }
    const out = gamePlayAlerts(hockey([early, { ...late, homeScore: 1, awayScore: 2, id: 'x', clock: '15:00', scoring: false, type: 'Hit' }, late]))
    expect(out.map(a => a.key)).toEqual(['play:l'])
    expect(out[0]).toMatchObject({ imageUrl: 'https://img/s1.png', severity: 'high' })
    expect(out[0]!.body).toContain('Auston Matthews scores')
  })
  it('names the goalie on a big late save against the trailing team, at most twice per game', () => {
    const save = (id: string) => ({ id, text: 'Shot saved', type: 'Shot', scoring: false, period: 3, clock: '0:40', homeScore: 2, awayScore: 3, athleteIds: ['s1', 'g1'], teamId: 'h' })
    const out = gamePlayAlerts(hockey([{ id: '0', text: 'Goal', scoring: true, period: 1, clock: '5:00', homeScore: 2, awayScore: 3, athleteIds: [], teamId: 'a' }, save('a'), save('b'), save('c')]))
    expect(out.map(a => a.key)).toEqual(['play:a', 'play:b'])
    expect(out[0]!.body).toContain('Igor Shesterkin')
  })
})

describe('baseball', () => {
  const mlb = (prev: Partial<GameObservation>, next: Partial<GameObservation>) => keys('MLB', prev, next)
  it('sends no inning updates through six innings', () => {
    expect(mlb({ period: 6, statusDetail: 'Top 6th' }, { period: 6, statusDetail: 'Bot 6th' })).toEqual([])
    expect(mlb({ period: 5, statusDetail: 'Bot 5th' }, { period: 6, statusDetail: 'Top 6th' })).toEqual([])
  })
  it('sends the seventh-inning stretch, then the end of every inning', () => {
    expect(mlb({ period: 7, statusDetail: 'Top 7th' }, { period: 7, statusDetail: 'Mid 7th' })).toEqual(['inning:7:mid'])
    expect(mlb({ period: 7, statusDetail: 'Bot 7th' }, { period: 7, statusDetail: 'End 7th' })).toEqual(['inning:7:end'])
    expect(mlb({ period: 8, statusDetail: 'Bot 8th' }, { period: 9, statusDetail: 'Top 9th' })).toEqual(['inning:8:end'])
  })
  it('one buzz, not two, when a poll skips from the top of the 7th to the 8th', () => {
    expect(mlb({ period: 7, statusDetail: 'Top 7th' }, { period: 8, statusDetail: 'Top 8th' })).toEqual(['inning:7:end'])
  })
  it('sends every scoring play with the batter and a headshot, and labels multi-run homers', () => {
    const atBats = [{ id: 'run', scoring: true, result: 'Judge singled to left, Soto scored', batterId: '1', inning: 3, half: 'top', events: [] },
      { id: 'hr', scoring: true, resultType: 'Home Run', result: 'Ohtani homered to right (3-run)', batterId: '2', inning: 6, half: 'bottom', events: [] },
      { id: 'out', scoring: false, resultType: 'triple', result: 'Triple', events: [] }]
    const players = { '1': [{ name: 'Aaron Judge', headshot: 'https://img/1.png', group: 'batting' }], '2': [{ name: 'Shohei Ohtani', headshot: 'https://img/2.png', group: 'batting' }] }
    const out = gamePlayAlerts({ sport: 'MLB', drives: [], scoringPlays: [], players, baseball: { atBats } } as unknown as LiveGameDetail)
    expect(out.map(x => x.key)).toEqual(['play:run', 'play:hr'])
    expect(out[1]).toMatchObject({ imageUrl: 'https://img/2.png', title: expect.stringContaining('3-run home run') })
    expect(out[0]!.body).toContain('Aaron Judge')
  })
})

describe('football plays', () => {
  const players = {
    qb: [{ name: 'Patrick Mahomes', headshot: 'https://img/qb.png', group: 'passing' }],
    te: [{ name: 'Travis Kelce', headshot: 'https://img/te.png', group: 'receiving' }],
  }
  const nfl = (plays: object[], drive: object = { teamId: 'h' }) => ({ sport: 'NFL', scoringPlays: [], players, home: { id: 'h', abbrev: 'KC' }, away: { id: 'a', abbrev: 'BUF' },
    drives: [{ ...drive, plays }] } as unknown as LiveGameDetail)
  const play = (patch: object) => ({ id: 'p', text: 'play', type: null, statYardage: 0, scoring: false, period: 2, clock: '8:00', homeScore: null, awayScore: null, ...patch })

  it.each(['NFL', 'NCAAF'])('%s: 19+ yard plays and scoring plays only', sport => {
    const plays = [18, 19].map(n => play({ id: String(n), text: `${n} yard gain`, statYardage: n }))
    plays.push(play({ id: 'td', text: 'Touchdown', statYardage: 1, scoring: true, homeScore: 7, awayScore: 0 }))
    expect(gamePlayAlerts({ ...nfl(plays), sport }).map(x => x.key)).toEqual(['play:19', 'play:td'])
  })
  it('does not count a punt, a kickoff or a penalty as a big play', () => {
    const plays = [
      play({ id: 'punt', type: 'Punt', text: 'T.Townsend punts 52 yards to BUF 10', statYardage: 52 }),
      play({ id: 'ko', type: 'Kickoff', text: 'H.Butker kicks 65 yards from KC 35', statYardage: 65 }),
      play({ id: 'pen', type: 'Penalty', text: 'PENALTY on BUF, Defensive Pass Interference, 31 yards', statYardage: 31 }),
    ]
    expect(gamePlayAlerts(nfl(plays))).toEqual([])
  })
  it('names the QB and the receiver, with the receiver’s headshot', () => {
    const [a] = gamePlayAlerts(nfl([play({ text: 'P.Mahomes pass deep right to T.Kelce for 31 yards', statYardage: 31 })]))
    expect(a!.body).toContain('QB Patrick Mahomes → Travis Kelce')
    expect(a!.imageUrl).toBe('https://img/te.png')
    expect(a!.athleteIds).toEqual(['qb', 'te'])
  })
  it('labels defensive and special-teams scores, and sends sacks', () => {
    const label = (p: object) => footballPlayKind(play(p))?.kind
    expect(label({ text: 'J.Allen pass INTERCEPTED by T.McDuffie, returned for a TOUCHDOWN', scoring: true })).toBe('pick_six')
    expect(label({ text: 'Fumble recovered by C.Jones and returned 40 yards for a TOUCHDOWN', scoring: true })).toBe('fumble_td')
    expect(label({ text: 'M.Hardman punt return for 80 yds for a TD', scoring: true })).toBe('punt_return_td')
    expect(label({ text: 'Kickoff return for 100 yards for a TOUCHDOWN', scoring: true })).toBe('kick_return_td')
    expect(label({ type: 'Sack', text: 'J.Allen sacked by C.Jones for -8 yards' })).toBe('sack')
    expect(gamePlayAlerts(nfl([play({ type: 'Sack', text: 'J.Allen sacked for -8', statYardage: -8 })]))[0]!.type).toBe('game_big_play')
  })
  it('never sends an extra point or a missed field goal outside a late one-possession game', () => {
    const plays = [
      play({ id: 'xp', type: 'Extra Point Good', text: 'H.Butker extra point is GOOD', scoring: true, homeScore: 7, awayScore: 0 }),
      play({ id: 'fg', type: 'Field Goal Missed', text: 'H.Butker 48 yard field goal is No Good' }),
    ]
    expect(gamePlayAlerts(nfl(plays))).toEqual([])
  })
  it('sends late field goals made, missed or blocked by a team down 0-3, as clutch', () => {
    const lead = play({ id: 'lead', text: 'Touchdown', scoring: true, period: 3, homeScore: 17, awayScore: 20 })
    const miss = play({ id: 'miss', type: 'Field Goal Missed', text: 'H.Butker 52 yard field goal is No Good', period: 4, clock: '0:30', homeScore: 17, awayScore: 20 })
    const block = play({ id: 'block', type: 'Blocked Field Goal', text: 'H.Butker field goal is BLOCKED', period: 4, clock: '0:10', homeScore: 17, awayScore: 20 })
    const out = gamePlayAlerts(nfl([lead, miss, block]))
    expect(out.map(a => a.key)).toEqual(['play:lead', 'play:miss', 'play:block'])
    expect(out[1]!.title).toContain('Clutch')
    expect(out[2]!.title).toContain('BLOCKED')
    // Up 10 late, a missed field goal is not news.
    const comfy = gamePlayAlerts(nfl([play({ id: 'up', text: 'TD', scoring: true, period: 3, homeScore: 27, awayScore: 17 }), { ...miss, homeScore: 27, awayScore: 17 }]))
    expect(comfy.map(a => a.key)).toEqual(['play:up'])
  })
  it('marks a late touchdown by a team down 0-8 as clutch and reports the try', () => {
    const plays = [
      play({ id: 'a', text: 'TD', scoring: true, period: 3, homeScore: 14, awayScore: 21 }),
      play({ id: 'b', text: 'P.Mahomes pass to T.Kelce for 5 yards for a TOUCHDOWN (H.Butker Kick)', scoring: true, period: 4, clock: '1:12', homeScore: 21, awayScore: 21 }),
    ]
    const out = gamePlayAlerts(nfl(plays))
    expect(out[1]!.title).toContain('Clutch')
    expect(out[1]!.body).toContain('Extra point GOOD')
    expect(out[1]!.severity).toBe('high')
  })
  it('sends a late standalone two-point try in a one-score game', () => {
    const plays = [
      play({ id: 'td', text: 'TD', scoring: true, period: 4, clock: '0:40', homeScore: 20, awayScore: 22 }),
      play({ id: 'two', type: 'Two-Point Conversion', text: 'TWO-POINT CONVERSION ATTEMPT. ATTEMPT FAILS.', period: 4, clock: '0:40', homeScore: 20, awayScore: 22 }),
    ]
    expect(gamePlayAlerts(nfl(plays)).find(a => a.key === 'play:two')!.title).toContain('NO GOOD')
  })
})

describe('channel policy', () => {
  it('allows SMS only for league operations with league context', () => {
    expect(allowsLeagueSms('draft_alerts', 'league')).toBe(true)
    expect(allowsLeagueSms('draft_alerts')).toBe(false)
    for (const category of ['injury_alerts', 'lineup_alerts', 'performance_alerts', 'ai_alerts', 'matchup_results'] as const) expect(allowsLeagueSms(category, 'league')).toBe(false)
  })
})
