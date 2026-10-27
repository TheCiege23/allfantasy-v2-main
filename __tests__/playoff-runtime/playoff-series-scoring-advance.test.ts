/**
 * Best-of-N series in the REAL scorer and the REAL bracket advance.
 *
 *  - The scorer, in series mode, scores each week as one game and writes the matchup final the moment
 *    a team clinches (here after two of three weeks), with `metadata.series` carrying the record. Until
 *    then it writes the running series and leaves the score columns null — the advance-safety rule.
 *  - A league with no `playoff_series` is scored exactly as before (cumulative weeks).
 *  - The advance decides a series by game wins re-derived from the stored games: a team that scored
 *    MORE total points but won fewer games is eliminated, and a tied week goes to the higher seed.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { scoreActivePlayoffRound } from '@/lib/playoff-runtime/playoffRoundScoring'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffRuntimeState,
  type NflRedraftPlayoffTeamInput,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'

type AnyArgs = Record<string, any>

function makeDb(opts: { settings?: unknown; currentWeek?: number; playoffStartWeek?: number }) {
  const updates: Array<{ id: string; data: AnyArgs }> = []
  const db = {
    redraftSeason: {
      findFirst: vi.fn(async () => ({
        id: 's1', leagueId: 'L1', season: 2026, status: 'playoffs',
        currentWeek: opts.currentWeek ?? 18, playoffStartWeek: opts.playoffStartWeek ?? 18,
      })),
      update: vi.fn(async (args: AnyArgs) => args),
    },
    redraftPlayoffRound: {
      findMany: vi.fn(async (args: AnyArgs) =>
        args.where.roundNumber?.gte != null
          ? []
          : [
              {
                roundNumber: 1,
                status: 'active',
                matchups: [
                  {
                    id: 'm1', homeRosterId: 'A', awayRosterId: 'B', homeSeed: 1, awaySeed: 4,
                    homeScore: null, awayScore: null, winnerRosterId: null, status: 'scheduled',
                    metadata: { bracketType: 'championship' },
                  },
                ],
              },
              { roundNumber: 2, status: 'pending', matchups: [] },
            ],
      ),
    },
    league: { findFirst: vi.fn(async () => ({ playoffWeeksPerRound: 1, settings: opts.settings ?? {} })) },
    redraftPlayoffMatchup: {
      update: vi.fn(async (args: AnyArgs) => {
        updates.push({ id: args.where.id, data: args.data })
        return args
      }),
    },
  }
  return { db: db as any, updates }
}

const sealedAll = vi.fn(async () => ({ finalized: true, alreadyFinal: false, refusal: null }) as any)
const sealedOnly = (weeks: number[]) =>
  vi.fn(async (p: AnyArgs) => ({ finalized: weeks.includes(p.week), alreadyFinal: false, refusal: weeks.includes(p.week) ? null : 'games_not_final' }) as any)

/** Points per roster per week: A wins weeks 18 and 19, then B blows A out in week 20. */
const points: Record<string, number> = { 'A@18': 110, 'B@18': 100, 'A@19': 105, 'B@19': 95, 'A@20': 10, 'B@20': 400 }
const scorer = vi.fn(async (args: AnyArgs) => ({
  rosterId: args.rosterId, starterCount: 9, scoredStarterCount: 9, missingPlayerIds: [], allFinal: true,
  points: points[`${args.rosterId}@${args.week}`] ?? 0,
}))

const SERIES_3 = { playoff_series: { mode: 'series', lengths: [3] } }

describe('the scorer in series mode', () => {
  it('a best-of-3 clinched 2-0 is written final after week 19, before its third week', async () => {
    const { db, updates } = makeDb({ settings: SERIES_3 })
    const res = await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: 19 }, { prisma: db, scoreRoster: scorer, finalizeWeek: sealedAll })
    expect(res.weeks).toEqual([18, 19, 20])
    expect(res.outcome).toBe('scored')
    const data = updates[0].data
    expect(data.status).toBe('final')
    expect(data.homeScore).toBe(215)
    expect(data.awayScore).toBe(195)
    expect(data.metadata.series).toMatchObject({ bestOf: 3, homeWins: 2, awayWins: 0, winnerRosterId: 'A', clinchedWeek: 19 })
    expect(data.metadata.live).toBeUndefined()
  })

  it('while not clinched the running series goes to metadata and the score columns stay null', async () => {
    const { db, updates } = makeDb({ settings: SERIES_3 })
    const res = await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: 19 }, { prisma: db, scoreRoster: scorer, finalizeWeek: sealedOnly([18]) })
    expect(res.outcome).toBe('live')
    const data = updates[0].data
    expect(data.status).toBeUndefined()
    expect(data.homeScore).toBeUndefined()
    expect(data.metadata.series).toMatchObject({ homeWins: 1, awayWins: 0, winnerRosterId: null })
    expect(data.metadata.series.games.at(-1)).toMatchObject({ week: 19, live: true, winnerRosterId: null })
  })

  it('without playoff_series the same weeks are scored cumulatively, as before', async () => {
    const { db, updates } = makeDb({ settings: {} })
    const res = await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: 18 }, { prisma: db, scoreRoster: scorer, finalizeWeek: sealedAll })
    expect(res.weeks).toEqual([18])
    expect(updates[0].data).toMatchObject({ homeScore: 110, awayScore: 100, status: 'final' })
    expect(updates[0].data.metadata.series).toBeUndefined()
  })
})

const teams: NflRedraftPlayoffTeamInput[] = Array.from({ length: 4 }, (_, i) => ({
  rosterId: `t${i + 1}`, displayName: `Team ${i + 1}`, wins: 10 - i, losses: i, pointsFor: 1000 - i * 10, pointsAgainst: 900,
}))
const rules = {
  general: { season: 2026, sport: 'NBA', teamCount: 4 },
  playoffs: {
    teamCount: 4, startWeek: 18, consolationBracketEnabled: false, toiletBowlEnabled: false, thirdPlaceGameEnabled: false,
    seedingRules: 'standings', tiebreakerRules: ['win_pct', 'points_for'], standingsTiebreakers: ['win_pct', 'points_for'],
    seriesLengths: [3, 5],
  },
  schedule: { regularSeasonLength: 17, playoffTransitionPoint: 18 },
}

/** Round 1 as the scorer leaves it: final, points in the columns, the games in metadata.series. */
function withRoundOne(state: NflRedraftPlayoffRuntimeState, games: Record<number, Array<[number, number]>>): NflRedraftPlayoffRuntimeState {
  const round1 = state.bracket.rounds[0]
  const matchups = round1.matchups.map((m, i) => {
    const g = (games[i] ?? []).map(([homePoints, awayPoints], j) => ({ week: 18 + j, homePoints, awayPoints, winnerRosterId: null }))
    return {
      ...m,
      status: 'final' as const,
      homeScore: g.reduce((t, x) => t + x.homePoints, 0),
      awayScore: g.reduce((t, x) => t + x.awayPoints, 0),
      metadata: { ...m.metadata, series: { bestOf: 3, homeWins: 0, awayWins: 0, winnerRosterId: null, clinchedWeek: null, games: g } },
    }
  })
  return { ...state, bracket: { ...state.bracket, rounds: [{ ...round1, matchups }, ...state.bracket.rounds.slice(1)] } }
}

describe('the bracket advance decides a series by game wins', () => {
  const base = buildNflRedraftPlayoffRuntimeState({ leagueId: 'L', seasonId: 'S', season: 2026, week: 18, rules, teams })
  const generated: NflRedraftPlayoffRuntimeState = { ...base, bracket: generateNflRedraftPlayoffBracket({ state: base }).bracket }

  it('carries the series lengths on the runtime settings for the board', () => {
    expect(base.settings.seriesLengths).toEqual([3, 5])
  })

  it('the team with MORE total points but fewer game wins is eliminated; a tied week goes to the higher seed', () => {
    const [m1, m2] = generated.bracket.rounds[0].matchups
    expect([m1.homeSeed, m1.awaySeed]).toEqual([1, 4])
    // m1: seed 1 wins game 1 by 400, loses games 2 and 3 by 1 → seed 4 wins the series on fewer points.
    // m2: game 1 tied (seed 2 takes it, the higher seed), seed 3 wins game 2, game 3 tied → seed 2 wins 2-1.
    const state = withRoundOne(generated, { 0: [[500, 100], [99, 100], [99, 100]], 1: [[100, 100], [90, 120], [80, 80]] })
    expect(state.bracket.rounds[0].matchups[0].homeScore).toBeGreaterThan(state.bracket.rounds[0].matchups[0].awayScore!)
    const advanced = advanceNflRedraftPlayoffRound({ state })
    if (!advanced.ok) throw new Error(`${advanced.code}: ${advanced.message}`)
    const decided = advanced.state.bracket.rounds[0].matchups
    expect(decided[0].winnerRosterId).toBe(m1.awayRosterId)
    expect(decided[1].winnerRosterId).toBe(m2.homeSeed! < m2.awaySeed! ? m2.homeRosterId : m2.awayRosterId)
    expect(advanced.eliminatedRosterIds).toContain(m1.homeRosterId)
  })

  it('a series with no winner yet blocks the round instead of falling back to points', () => {
    const state = withRoundOne(generated, { 0: [[500, 100]], 1: [[90, 120], [80, 100]] })
    const advanced = advanceNflRedraftPlayoffRound({ state })
    expect(advanced.ok).toBe(false)
    if (!advanced.ok) expect(advanced.blockedMatchupIds).toEqual([generated.bracket.rounds[0].matchups[0].matchupId])
  })
})
