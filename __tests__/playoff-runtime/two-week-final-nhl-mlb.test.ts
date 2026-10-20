/**
 * NHL and MLB play a two-week championship, and the champion is crowned from the SUM of both weeks.
 *
 * `championship-length.test.ts` proves the mechanism with a hand-written
 * `{ playoff_structure: { championship_length: 2 } }`. This runs the chain on what a league REALLY
 * gets, end to end:
 *
 *   league creation's settings snapshot (runPresetEngine, the creation path's own builder)
 *     -> scoreActivePlayoffRound over the final's weeks (the season's last two)
 *     -> the bracket runtime's advance + finalize, which decide the winner from those scores.
 *
 * Week one alone favours the AWAY team; the two-week sum favours HOME. A one-week final would crown
 * away, so the assertion can only pass if both weeks are played and summed.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { runPresetEngine } from '@/lib/league-creation/preset-engine/runPresetEngine'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffRuntimeState,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { scoreActivePlayoffRound } from '@/lib/playoff-runtime/playoffRoundScoring'
import { readChampionshipLength } from '@/lib/playoff-runtime/playoffRoundWeeks'
import { DAILY_SPORT_SEASON_SHAPE, playoffStartWeekFor } from '@/lib/sportConfig/dailySportSeasonShape'

type AnyArgs = Record<string, any>
const SPORTS = ['NHL', 'MLB'] as const

function createdSettings(sport: (typeof SPORTS)[number]) {
  const engine = runPresetEngine({
    concept: 'redraft',
    sport,
    teamCount: 12,
    draftType: 'snake',
    scoringPreset: sport === 'NHL' ? 'nhl_points' : 'mlb_points',
    leagueName: `${sport} two-week final`,
    commissionerId: 'commish-1',
  })
  return engine.settingsSnapshot as Record<string, unknown>
}

/** The DB the scorer reads: a three-round bracket whose final (round 3) is live. */
function playoffDb(settings: unknown, playoffStartWeek: number) {
  const updates: Array<{ id: string; data: AnyArgs }> = []
  const final = {
    id: 'final',
    homeRosterId: 'home',
    awayRosterId: 'away',
    homeScore: null,
    awayScore: null,
    winnerRosterId: null,
    status: 'scheduled',
    metadata: { bracketType: 'championship' },
  }
  const db = {
    redraftSeason: {
      findFirst: vi.fn(async () => ({ id: 's1', leagueId: 'L1', season: 2026, status: 'playoffs', currentWeek: playoffStartWeek, playoffStartWeek })),
      update: vi.fn(async (args: AnyArgs) => args),
    },
    redraftPlayoffRound: {
      findMany: vi.fn(async () => [
        { roundNumber: 1, status: 'completed', matchups: [] },
        { roundNumber: 2, status: 'completed', matchups: [] },
        { roundNumber: 3, status: 'active', matchups: [final] },
      ]),
    },
    league: { findFirst: vi.fn(async () => ({ playoffWeeksPerRound: 1, settings })) },
    redraftPlayoffMatchup: {
      update: vi.fn(async (args: AnyArgs) => {
        updates.push({ id: args.where.id, data: args.data })
        return args
      }),
    },
  }
  return { db: db as any, updates }
}

function rulesFor(sport: string, startWeek: number): CanonicalLeagueRules {
  return {
    version: 1,
    leagueId: 'L1',
    generatedAtIso: '2026-07-02T12:00:00.000Z',
    source: { commissionerSettings: 'League', draftSettings: 'LeagueSettings', effectiveResolvers: [], settingsSnapshotVersion: 7, presetKey: 'test' },
    general: { name: 'Two-week final', sport, season: 2026, format: 'redraft', variant: null, teamCount: 6, rosterSize: 20, lifecycleState: 'active', status: 'active', locked: false, emergencyPaused: false, timezone: 'America/New_York', language: 'en' },
    draft: {}, scoring: {}, roster: {}, waivers: {}, trades: {},
    playoffs: {
      teamCount: 6, startWeek, firstRoundByes: 2, consolationBracketEnabled: false, thirdPlaceGameEnabled: false,
      seedingRules: 'standard_standings', tiebreakerRules: ['win_pct', 'points_for'], byeRules: 'top_two_seeds_bye',
      reseedBehavior: 'fixed_bracket', standingsTiebreakers: ['win_pct', 'points_for'],
    },
    schedule: { unit: 'week', regularSeasonLength: startWeek - 1, matchupFrequency: 'weekly', matchupCadence: 'weekly', generationStrategy: 'round_robin', playoffTransitionPoint: startWeek, headToHeadBehavior: 'standard', lockTimeBehavior: 'daily', lockWindowBehavior: 'daily', scoringPeriodBehavior: 'weekly', rescheduleHandling: null, doubleheaderHandling: null },
    permissions: { settingsEditableByRoles: ['commissioner'], memberMovesLocked: false, inviteLinksDisabled: false, inviteCapacityOverride: false },
    intelligence: {},
  } as unknown as CanonicalLeagueRules
}

const TEAMS = ['t1', 't2', 't3', 't4', 't5', 't6'].map((rosterId, i) => ({
  rosterId, displayName: rosterId, ownerId: `u-${rosterId}`, divisionId: null,
  wins: 12 - i, losses: 2 + i, pointsFor: 1500 - i * 20, pointsAgainst: 1300, divisionWins: 0, divisionLosses: 0,
}))

/** Decide the active round the ordinary way: home wins every non-bye matchup. */
function scoreRound(state: NflRedraftPlayoffRuntimeState, home: number, away: number): NflRedraftPlayoffRuntimeState {
  return {
    ...state,
    bracket: {
      ...state.bracket,
      rounds: state.bracket.rounds.map((round) =>
        round.status !== 'active'
          ? round
          : { ...round, matchups: round.matchups.map((m) => (m.bye ? m : { ...m, homeScore: home, awayScore: away, status: 'final' })) },
      ),
    },
  }
}

describe.each(SPORTS)('%s — a two-week final scores both weeks and crowns from the sum', (sport) => {
  const shape = DAILY_SPORT_SEASON_SHAPE[sport]
  const start = playoffStartWeekFor(sport)
  const finalWeeks = [shape.totalWeeks - 1, shape.totalWeeks]
  // Week one: away 60-40. Week two: home 50-20. Sum: home 90-80.
  const points: Record<string, number> = {
    [`home@${finalWeeks[0]}`]: 40, [`away@${finalWeeks[0]}`]: 60,
    [`home@${finalWeeks[1]}`]: 50, [`away@${finalWeeks[1]}`]: 20,
  }
  const scoreRoster = vi.fn(async (args: AnyArgs) => ({
    rosterId: args.rosterId, starterCount: 9, scoredStarterCount: 9,
    points: points[`${args.rosterId}@${args.week}`] ?? 0, missingPlayerIds: [], allFinal: true,
  }))
  const sealAll = vi.fn(async () => ({ finalized: true, alreadyFinal: false, refusal: null }) as any)

  it('a newly created league stores a two-week final', () => {
    expect(readChampionshipLength(createdSettings(sport))).toBe(2)
  })

  it('the final is the season’s last two weeks, scored as their sum', async () => {
    const { db, updates } = playoffDb(createdSettings(sport), start)
    const res = await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: shape.totalWeeks }, { prisma: db, finalizeWeek: sealAll, scoreRoster })
    expect(res.weeks).toEqual(finalWeeks)
    expect(res.outcome).toBe('scored')
    expect(updates[0].data).toMatchObject({ homeScore: 90, awayScore: 80, status: 'final' })
    expect(updates[0].data.metadata.scoredWeeks).toEqual(finalWeeks)
  })

  it('after week one the title is still open', async () => {
    const { db, updates } = playoffDb(createdSettings(sport), start)
    const res = await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: finalWeeks[0] }, { prisma: db, finalizeWeek: sealAll, scoreRoster })
    expect(res.outcome).toBe('live')
    expect(updates[0].data.homeScore).toBeUndefined()
    expect(updates[0].data.metadata.live).toMatchObject({ homeScore: 40, awayScore: 60 })
  })

  it('the champion is the team that won the SUM, not week one', async () => {
    const { db, updates } = playoffDb(createdSettings(sport), start)
    await scoreActivePlayoffRound({ seasonId: 's1', calendarWeek: shape.totalWeeks }, { prisma: db, finalizeWeek: sealAll, scoreRoster })
    const { homeScore, awayScore } = updates[0].data as { homeScore: number; awayScore: number }

    let state = buildNflRedraftPlayoffRuntimeState({
      leagueId: 'L1', seasonId: 's1', season: 2026, week: start, rules: rulesFor(sport, start), teams: TEAMS as any,
      now: new Date('2026-07-02T12:00:00.000Z'),
    })
    state = { ...state, bracket: generateNflRedraftPlayoffBracket({ state, lockBracket: true }).bracket }
    expect(state.bracket.rounds).toHaveLength(3)

    for (const round of [1, 2]) {
      const r = advanceNflRedraftPlayoffRound({ state: scoreRound(state, 100, 90) })
      expect(r.ok, `round ${round}`).toBe(true)
      if (!r.ok) return
      state = r.state
    }
    // The final takes exactly the scores the two-week scorer wrote.
    const finalMatchup = state.bracket.rounds[2].matchups.find((m) => !m.bye)!
    const champ = advanceNflRedraftPlayoffRound({ state: scoreRound(state, homeScore, awayScore) })
    expect(champ.ok && champ.status).toBe('championship_ready')
    if (!champ.ok) return
    const crowned = finalizeNflRedraftPlayoffChampion({ state: champ.state })
    expect(crowned.ok).toBe(true)
    if (!crowned.ok) return
    expect(crowned.championRosterId).toBe(finalMatchup.homeRosterId)
    expect(crowned.runnerUpRosterId).toBe(finalMatchup.awayRosterId)
  })
})
