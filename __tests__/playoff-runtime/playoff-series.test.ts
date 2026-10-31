/**
 * Best-of-N playoff series (lib/playoff-runtime/playoffSeries.ts) — the pure rules every reader shares.
 *
 *  1. Series math: first to ceil(N/2) game wins, a clinch ends the series early, a tied week goes to
 *     the HIGHER seed (lower seed number), equal seeds leave it for the commissioner.
 *  2. Config: one length per round, 1/3/5/7 only, all-1 is "off" (today's cumulative rounds).
 *  3. Window sizing: a best-of-N round lasts N weeks and rounds may differ, so the bracket's weeks are
 *     the SUM of its series — and the fit helpers (fittedPlayoffStartWeek, maxPlayoffTeamsThatFit)
 *     size the window from that same rule. Cumulative mode is unchanged.
 *  4. Gating helper: only a CHANGE to a series (N > 1) needs the plan; turning it off never does.
 *  5. The seed preview's series schedule is built from the same week rule.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import {
  parsePlayoffSeriesLengths,
  playoffSeriesChangeNeedsPlan,
  playoffSeriesView,
  readPlayoffSeriesLengths,
  readStoredPlayoffSeries,
  resolvePlayoffSeries,
  seriesLengthForRound,
  seriesWinsNeeded,
} from '@/lib/playoff-runtime/playoffSeries'
import { lastWeekOfPlayoffRound, playoffRoundWeeks } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { fittedPlayoffStartWeek, maxPlayoffTeamsThatFit, playoffBracketWeeks, playoffFinalWeek } from '@/lib/playoff-runtime/playoffFit'
import { playoffSeriesSchedule } from '@/lib/playoff-runtime/playoffSeedPreview'

const H = 'home'
const A = 'away'
const series = (bestOf: number, games: Array<[number, number]>, seeds: [number | null, number | null] = [1, 4]) =>
  resolvePlayoffSeries({
    bestOf,
    homeRosterId: H,
    awayRosterId: A,
    homeSeed: seeds[0],
    awaySeed: seeds[1],
    games: games.map(([homePoints, awayPoints], i) => ({ week: 20 + i, homePoints, awayPoints })),
  })

describe('series math', () => {
  it('a majority wins: 2 of 3, 3 of 5, 4 of 7', () => {
    expect([1, 3, 5, 7].map(seriesWinsNeeded)).toEqual([1, 2, 3, 4])
  })

  it('best of 3 — clinched early after two straight wins, the third week is ignored', () => {
    const r = series(3, [[110, 100], [120, 90], [50, 200]])
    expect(r.winnerRosterId).toBe(H)
    expect(r.loserRosterId).toBe(A)
    expect([r.homeWins, r.awayWins]).toEqual([2, 0])
    expect(r.clinchedWeek).toBe(21)
    expect(r.games).toHaveLength(2)
  })

  it('best of 3 — goes the distance', () => {
    const r = series(3, [[110, 100], [90, 120], [80, 100]])
    expect(r.winnerRosterId).toBe(A)
    expect([r.homeWins, r.awayWins]).toEqual([1, 2])
    expect(r.clinchedWeek).toBe(22)
  })

  it('best of 5 — not decided at 2-2, decided by game 5', () => {
    const four = series(5, [[1, 0], [0, 1], [1, 0], [0, 1]])
    expect(four.winnerRosterId).toBeNull()
    expect([four.homeWins, four.awayWins]).toEqual([2, 2])
    const five = series(5, [[1, 0], [0, 1], [1, 0], [0, 1], [0, 9]])
    expect(five.winnerRosterId).toBe(A)
    expect(five.clinchedWeek).toBe(24)
  })

  it('best of 7 — a 4-0 sweep clinches in the fourth week', () => {
    const r = series(7, [[2, 1], [2, 1], [2, 1], [2, 1], [0, 5], [0, 5], [0, 5]])
    expect(r.winnerRosterId).toBe(H)
    expect(r.clinchedWeek).toBe(23)
    expect(r.games).toHaveLength(4)
  })

  it('a series decides by game WINS, not total points', () => {
    // Home scores 400 more points overall and still loses 1-2.
    const r = series(3, [[500, 10], [90, 100], [99, 100]])
    expect(r.winnerRosterId).toBe(A)
  })

  it('a tied week goes to the HIGHER seed (lower number), whichever side it is on', () => {
    const homeHigher = series(3, [[100, 100], [100, 100]], [1, 4])
    expect(homeHigher.winnerRosterId).toBe(H)
    expect(homeHigher.games.every((g) => g.decidedBySeed)).toBe(true)
    const awayHigher = series(3, [[100, 100], [100, 100]], [5, 2])
    expect(awayHigher.winnerRosterId).toBe(A)
  })

  it('a tied week with equal or missing seeds is left for the commissioner', () => {
    const r = series(3, [[100, 100]], [3, 3])
    expect(r.winnerRosterId).toBeNull()
    expect(r.blockedReason).toMatch(/commissioner/)
    expect(series(3, [[100, 100]], [null, 2]).winnerRosterId).toBeNull()
  })

  it('games are taken in week order whatever order they arrive in', () => {
    const r = resolvePlayoffSeries({
      bestOf: 3, homeRosterId: H, awayRosterId: A, homeSeed: 1, awaySeed: 2,
      games: [{ week: 22, homePoints: 0, awayPoints: 1 }, { week: 20, homePoints: 1, awayPoints: 0 }, { week: 21, homePoints: 1, awayPoints: 0 }],
    })
    expect(r.clinchedWeek).toBe(21)
    expect(r.winnerRosterId).toBe(H)
  })
})

describe('series config', () => {
  it('reads settings.playoff_series; anything else is cumulative (null)', () => {
    expect(readPlayoffSeriesLengths({ playoff_series: { mode: 'series', lengths: [3, 3, 5] } })).toEqual([3, 3, 5])
    expect(readPlayoffSeriesLengths({})).toBeNull()
    expect(readPlayoffSeriesLengths(null)).toBeNull()
    expect(readPlayoffSeriesLengths({ playoff_series: { mode: 'cumulative', lengths: [3] } })).toBeNull()
    expect(readPlayoffSeriesLengths({ playoff_series: { mode: 'series', lengths: [1, 1] } })).toBeNull()
    expect(readPlayoffSeriesLengths({ playoff_series: { mode: 'series', lengths: [4] } })).toBeNull()
  })

  it('parses a commissioner submission: 1/3/5/7 only, all-1 or null is off', () => {
    expect(parsePlayoffSeriesLengths([3, '5'])).toEqual({ ok: true, value: [3, 5] })
    expect(parsePlayoffSeriesLengths([1, 1, 1])).toEqual({ ok: true, value: null })
    expect(parsePlayoffSeriesLengths(null)).toEqual({ ok: true, value: null })
    for (const bad of [[2], [9], [3.5], 'three', [0], Array(9).fill(3)]) {
      expect(parsePlayoffSeriesLengths(bad).ok).toBe(false)
    }
  })

  it('a round past the list plays the last length', () => {
    expect(seriesLengthForRound([3, 5], 1)).toBe(3)
    expect(seriesLengthForRound([3, 5], 2)).toBe(5)
    expect(seriesLengthForRound([3, 5], 4)).toBe(5)
    expect(seriesLengthForRound(null, 2)).toBe(1)
  })

  it('only a CHANGE to N > 1 needs the plan; re-saving or turning off never does', () => {
    expect(playoffSeriesChangeNeedsPlan([3, 5], null)).toBe(true)
    expect(playoffSeriesChangeNeedsPlan([3, 7], [3, 5])).toBe(true)
    expect(playoffSeriesChangeNeedsPlan([3, 5], [3, 5])).toBe(false)
    expect(playoffSeriesChangeNeedsPlan(null, [3, 5])).toBe(false)
  })
})

describe('window sizing — a best-of-N round lasts N weeks', () => {
  it('rounds of different lengths start where the previous one ended', () => {
    const lengths = [3, 3, 5]
    expect(playoffRoundWeeks({ playoffStartWeek: 15, roundNumber: 1, seriesLengths: lengths })).toEqual([15, 16, 17])
    expect(playoffRoundWeeks({ playoffStartWeek: 15, roundNumber: 2, seriesLengths: lengths })).toEqual([18, 19, 20])
    expect(playoffRoundWeeks({ playoffStartWeek: 15, roundNumber: 3, seriesLengths: lengths })).toEqual([21, 22, 23, 24, 25])
  })

  it('series mode ignores weeks per round and championship length', () => {
    expect(
      lastWeekOfPlayoffRound({ playoffStartWeek: 15, roundNumber: 2, weeksPerRound: 2, finalRoundNumber: 2, championshipLength: 4, seriesLengths: [3, 3] }),
    ).toBe(20)
  })

  it('cumulative mode (no series) is unchanged', () => {
    expect(playoffRoundWeeks({ playoffStartWeek: 15, roundNumber: 2, weeksPerRound: 2, seriesLengths: null })).toEqual([17, 18])
    expect(playoffBracketWeeks({ teams: 6, weeksPerRound: 1, championshipLength: 2 })).toBe(4)
  })

  it('the bracket is rounds × N weeks, and creation fits the final into the season', () => {
    // 6 teams = 3 rounds; best of 3 everywhere = 9 weeks.
    expect(playoffBracketWeeks({ teams: 6, seriesLengths: [3] })).toBe(9)
    expect(playoffBracketWeeks({ teams: 6, seriesLengths: [3, 3, 5] })).toBe(11)
    // NBA's 25-week season: the start that puts the final in week 25.
    expect(fittedPlayoffStartWeek({ teams: 6, seriesLengths: [3], seasonWeeks: 25 })).toBe(17)
    expect(playoffFinalWeek({ teams: 6, seriesLengths: [3], playoffStartWeek: 17 })).toBe(25)
  })

  it('the largest field that fits shrinks as the series lengthen', () => {
    // NBA 25 weeks, playoffs from week 15: one-week rounds fit 16 teams (4 weeks).
    expect(maxPlayoffTeamsThatFit({ seasonWeeks: 25, playoffStartWeek: 15, leagueSize: 16 })).toBe(16)
    // Best of 3 → 3 weeks a round: 3 rounds (9 weeks, 15-23) fit, 4 rounds (12 weeks) do not.
    expect(maxPlayoffTeamsThatFit({ seasonWeeks: 25, playoffStartWeek: 15, leagueSize: 16, seriesLengths: [3] })).toBe(8)
    // Best of 7 → 7 weeks a round: one round (15-21) fits, two (14 weeks) do not — a 2-team final.
    expect(maxPlayoffTeamsThatFit({ seasonWeeks: 25, playoffStartWeek: 15, leagueSize: 16, seriesLengths: [7] })).toBe(2)
  })
})

describe('stored series and the bracket view', () => {
  const stored = {
    series: {
      bestOf: 5, homeWins: 2, awayWins: 1, winnerRosterId: null, clinchedWeek: null,
      games: [
        { week: 20, homePoints: 10, awayPoints: 5, winnerRosterId: H },
        { week: 21, homePoints: 1, awayPoints: 5, winnerRosterId: A },
        { week: 22, homePoints: 10, awayPoints: 5, winnerRosterId: H },
        { week: 23, homePoints: 3, awayPoints: 4, winnerRosterId: null, live: true },
      ],
    },
  }

  it('reads what the scorer writes, live games flagged', () => {
    const s = readStoredPlayoffSeries(stored)!
    expect(s.bestOf).toBe(5)
    expect(s.games.filter((g) => g.live)).toHaveLength(1)
    expect(readStoredPlayoffSeries({})).toBeNull()
    expect(readStoredPlayoffSeries({ series: { bestOf: 1, games: [] } })).toBeNull()
  })

  it('the view: in progress with a leader, won with a winner, not started, or null for a single week', () => {
    expect(playoffSeriesView({ bestOf: 5, metadata: stored, homeRosterId: H, awayRosterId: A })).toMatchObject({
      state: 'in_progress', leaderRosterId: H, homeWins: 2, awayWins: 1, winsNeeded: 3,
    })
    expect(playoffSeriesView({ bestOf: 3, metadata: {}, homeRosterId: H, awayRosterId: A })).toMatchObject({ state: 'not_started' })
    expect(playoffSeriesView({ bestOf: 1, metadata: {}, homeRosterId: H, awayRosterId: A })).toBeNull()
    const won = { series: { ...stored.series, homeWins: 3, winnerRosterId: H } }
    expect(playoffSeriesView({ bestOf: 5, metadata: won, homeRosterId: H, awayRosterId: A })).toMatchObject({ state: 'won', winnerRosterId: H })
  })
})

describe('seed preview series schedule', () => {
  it('uses the scorer\'s week rule; null in cumulative mode', () => {
    expect(playoffSeriesSchedule({ playoffStartWeek: 18, roundCount: 2, seriesLengths: [3, 5] })).toEqual([
      { roundNumber: 1, bestOf: 3, winsNeeded: 2, weeks: [18, 19, 20] },
      { roundNumber: 2, bestOf: 5, winsNeeded: 3, weeks: [21, 22, 23, 24, 25] },
    ])
    expect(playoffSeriesSchedule({ playoffStartWeek: 18, roundCount: 2, seriesLengths: null })).toBeNull()
  })
})
