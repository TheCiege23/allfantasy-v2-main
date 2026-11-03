/**
 * The /core league Home redraft deck mapping (lib/core-app/redraftLeagueHome.ts): every block is
 * built from real rows and DROPS — never guesses — when its input is missing.
 */
import { describe, expect, it } from 'vitest'
import { buildRedraftHomeDeck, type BuildRedraftHomeDeckInput } from '@/lib/core-app/redraftLeagueHome'
import type { LeagueScoreboard, ScoreboardTeam } from '@/lib/core-app/leagueScoreboard'

const team = (id: string, name: string, points: number | null, over: Partial<ScoreboardTeam> = {}): ScoreboardTeam => ({
  rosterId: id,
  teamName: name,
  managerName: null,
  avatarUrl: null,
  points,
  projected: null,
  projectedFrom: 9,
  starterCount: 9,
  isYou: false,
  ...over,
})
const board = (week: number, games: Array<[ScoreboardTeam, ScoreboardTeam]>, extra: Partial<LeagueScoreboard> = {}): LeagueScoreboard => ({
  seasonYear: 2026,
  week,
  games: games.map(([a, b], i) => ({
    matchupId: i + 1,
    teams: [a, b],
    winProbability: null,
    unplayed: a.points == null && b.points == null,
    margin: a.points != null && b.points != null ? Math.abs(a.points - b.points) : null,
  })),
  allUnplayed: games.every(([a, b]) => a.points == null && b.points == null),
  unpaired: [],
  projectionBasis: null,
  unpricedReason: null,
  ...extra,
})
const standings = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({ teamName: name, wins: 5 - i, losses: i, ties: 0, rank: i + 1, isYou: name === 'C' }))
const settings = { regular_season_length: 14, playoff_start_week: 15, trade_deadline_week: 11, playoff_teams: 4 }

const base = (over: Partial<BuildRedraftHomeDeckInput> = {}): BuildRedraftHomeDeckInput => ({
  identity: { sport: 'nba', sportLabel: 'NBA' },
  settings,
  currentWeek: 6,
  stage: 'in_season',
  preSeason: false,
  standings,
  board: null,
  lastWeekBoard: null,
  ...over,
})

describe('season track facts', () => {
  it('reads the league\'s own weeks; no season total is invented for an import', () => {
    const deck = buildRedraftHomeDeck(base())
    expect(deck.sport).toBe('nba')
    expect(deck.track).toEqual({ currentWeek: 6, totalWeeks: null, playoffStartWeek: 15, tradeDeadlineWeek: 11, draftComplete: true, drafting: false })
    expect(deck.regularSeason).toEqual({ week: 6, of: 14 })
  })
  it('drops what is not stored', () => {
    const deck = buildRedraftHomeDeck(base({ settings: {}, currentWeek: null }))
    expect(deck.track.playoffStartWeek).toBeNull()
    expect(deck.track.tradeDeadlineWeek).toBeNull()
    expect(deck.track.currentWeek).toBeNull()
    expect(deck.regularSeason).toBeNull()
  })
  it('the 99 "no deadline" sentinel is no deadline', () => {
    expect(buildRedraftHomeDeck(base({ settings: { ...settings, trade_deadline_week: 99 } })).track.tradeDeadlineWeek).toBeNull()
  })
  it('a week past the regular season is not "week 16 of 14"', () => {
    expect(buildRedraftHomeDeck(base({ currentWeek: 16 })).regularSeason).toBeNull()
  })
  it('before the draft: no week, no blocks, and the phase says so', () => {
    const deck = buildRedraftHomeDeck(base({ preSeason: true, stage: 'pre_draft', board: board(1, [[team('1', 'A', null, { isYou: true }), team('2', 'B', null)]]) }))
    expect(deck.track.draftComplete).toBe(false)
    expect(deck.track.currentWeek).toBeNull()
    expect(deck.phaseLabel).toBe('Before the draft')
    expect(deck.scoreBug).toBeNull()
    expect(deck.playoffRace).toBeNull()
    expect(deck.recap).toBeNull()
  })
  it('a live draft marks the draft as now', () => {
    expect(buildRedraftHomeDeck(base({ preSeason: true, stage: 'drafting' })).track.drafting).toBe(true)
  })
})

describe('score bug', () => {
  it('an unplayed week shows projections, never a score, with the viewer\'s odds', () => {
    const b = board(6, [[team('1', 'B', null, { projected: 101.2 }), team('2', 'C', null, { projected: 95.5, isYou: true })]])
    b.games[0].winProbability = 0.7 // chance the FIRST team (the opponent) wins
    const bug = buildRedraftHomeDeck(base({ board: b })).scoreBug!
    expect(bug.state).toBe('upcoming')
    expect(bug.you).toMatchObject({ name: 'C', points: null, projected: 95.5, isYou: true, record: '3–2' })
    expect(bug.opponent).toMatchObject({ name: 'B', points: null, projected: 101.2, record: '4–1' })
    expect(bug.winPct).toBe(30)
  })
  it('a scored current week shows points; a past week is final', () => {
    const g: [ScoreboardTeam, ScoreboardTeam] = [team('1', 'C', 110.4, { isYou: true, projected: 99 }), team('2', 'D', 98.1)]
    expect(buildRedraftHomeDeck(base({ board: board(6, [g]) })).scoreBug).toMatchObject({ state: 'scored', you: { points: 110.4, projected: null } })
    expect(buildRedraftHomeDeck(base({ board: board(5, [g]) })).scoreBug?.state).toBe('final')
  })
  it('no game for the viewer → no bug; no model → no odds', () => {
    expect(buildRedraftHomeDeck(base({ board: board(6, [[team('1', 'A', null), team('2', 'B', null)]]) })).scoreBug).toBeNull()
    expect(buildRedraftHomeDeck(base({ board: board(6, [[team('1', 'C', null, { isYou: true }), team('2', 'B', null)]]) })).scoreBug?.winPct).toBeNull()
  })
  it('an opponent whose name matches two standings rows gets no record rather than the wrong one', () => {
    const dup = [...standings, { teamName: 'B', wins: 0, losses: 5, ties: 0, rank: 7, isYou: false }]
    const bug = buildRedraftHomeDeck(base({ standings: dup, board: board(6, [[team('1', 'C', null, { isYou: true }), team('2', 'B', null)]]) })).scoreBug!
    expect(bug.opponent.record).toBeNull()
  })
})

describe('playoff race', () => {
  it('draws the line after the league\'s own playoff team count', () => {
    const race = buildRedraftHomeDeck(base()).playoffRace!
    expect(race.spots).toBe(4)
    expect(race.rows.map(r => r.inLine)).toEqual([true, true, true, true, false, false])
    expect(race.rows.find(r => r.isYou)).toMatchObject({ teamName: 'C', record: '3–2', inLine: true })
  })
  it('orders by rank, not by input order', () => {
    const shuffled = [standings[3], standings[0], standings[5], standings[1], standings[4], standings[2]]
    expect(buildRedraftHomeDeck(base({ standings: shuffled })).playoffRace!.rows.map(r => r.teamName)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })
  it('no stated playoff count, a count ≥ the league, or no decided game → no race', () => {
    expect(buildRedraftHomeDeck(base({ settings: { regular_season_length: 14 } })).playoffRace).toBeNull()
    expect(buildRedraftHomeDeck(base({ settings: { ...settings, playoff_teams: 6 } })).playoffRace).toBeNull()
    expect(buildRedraftHomeDeck(base({ standings: standings.map(s => ({ ...s, wins: 0, losses: 0 })) })).playoffRace).toBeNull()
    expect(buildRedraftHomeDeck(base({ standings: null })).playoffRace).toBeNull()
  })
  it('ties are shown, never folded into losses', () => {
    const race = buildRedraftHomeDeck(base({ standings: standings.map((s, i) => (i === 0 ? { ...s, ties: 1 } : s)) })).playoffRace!
    expect(race.rows[0].record).toBe('5–0–1')
  })
})

describe('last week\'s recap', () => {
  const finished = board(5, [
    [team('1', 'A', 120.5), team('2', 'B', 119.9)],
    [team('3', 'C', 88), team('4', 'D', 131.25)],
    [team('5', 'E', 101), team('6', 'F', 90)],
  ])
  it('top score, closest game and biggest win, from a finished week', () => {
    const recap = buildRedraftHomeDeck(base({ lastWeekBoard: finished })).recap!
    expect(recap.week).toBe(5)
    expect(recap.topScore).toEqual({ team: 'D', points: 131.25 })
    expect(recap.closest).toEqual({ winner: 'A', loser: 'B', margin: 0.6 })
    expect(recap.biggestWin).toEqual({ winner: 'D', loser: 'C', margin: 43.25 })
  })
  it('one unfinished game anywhere → no recap at all', () => {
    const partial = board(5, [[team('1', 'A', 120.5), team('2', 'B', 119.9)], [team('3', 'C', 88), team('4', 'D', null)]])
    expect(buildRedraftHomeDeck(base({ lastWeekBoard: partial })).recap).toBeNull()
  })
  it('the current week (or later) is never a recap, and an unplayed week is not', () => {
    expect(buildRedraftHomeDeck(base({ lastWeekBoard: { ...finished, week: 6 } })).recap).toBeNull()
    expect(buildRedraftHomeDeck(base({ lastWeekBoard: { ...finished, allUnplayed: true } })).recap).toBeNull()
    expect(buildRedraftHomeDeck(base({ currentWeek: null, lastWeekBoard: finished })).recap).toBeNull()
  })
  it('a single decided game gives no separate "biggest win"', () => {
    const one = board(5, [[team('1', 'A', 120.5), team('2', 'B', 100)]])
    expect(buildRedraftHomeDeck(base({ lastWeekBoard: one })).recap).toMatchObject({ closest: { margin: 20.5 }, biggestWin: null })
  })
})
