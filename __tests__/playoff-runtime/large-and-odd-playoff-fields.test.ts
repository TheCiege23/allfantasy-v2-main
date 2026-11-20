/**
 * Playoff fields a big league needs: odd sizes (the top seeds sit out round one) and up to 32 teams.
 * Each field is generated and played to a champion through the real bracket engine.
 */
import { describe, expect, it } from 'vitest'

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffRuntimeState,
  type NflRedraftPlayoffTeamInput,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { MAX_PLAYOFF_TEAMS, firstRoundByesForTeams, playoffRoundsForTeams } from '@/lib/playoff-runtime/playoffFit'
import { checkByePlan, naturalByePlan } from '@/lib/playoff-brackets/byePlan'

function rulesFor(leagueTeams: number, playoffTeams: number): CanonicalLeagueRules {
  return {
    version: 1,
    leagueId: 'league-big',
    generatedAtIso: '2026-07-02T12:00:00.000Z',
    source: { commissionerSettings: 'League', draftSettings: 'LeagueSettings', effectiveResolvers: [], settingsSnapshotVersion: 1, presetKey: 'test' },
    general: {
      name: 'Big', sport: 'NFL', season: 2026, format: 'redraft', variant: null, teamCount: leagueTeams, rosterSize: 16,
      lifecycleState: 'active', status: 'active', locked: false, emergencyPaused: false, timezone: 'America/New_York', language: 'en',
    },
    draft: {}, scoring: {}, roster: {}, waivers: {}, trades: {},
    playoffs: {
      teamCount: playoffTeams, startWeek: 14, consolationBracketEnabled: false, thirdPlaceGameEnabled: false,
      seedingRules: 'standings', tiebreakerRules: ['win_pct', 'points_for'], byeRules: 'top_seed_byes',
      reseedBehavior: 'reseed_after_each_round', standingsTiebreakers: ['win_pct', 'points_for'],
    },
    schedule: {
      unit: 'week', regularSeasonLength: 13, matchupFrequency: 'weekly', matchupCadence: 'weekly', generationStrategy: 'round_robin',
      playoffTransitionPoint: 14, headToHeadBehavior: 'standard', lockTimeBehavior: 'per_player_kickoff', lockWindowBehavior: 'nfl_week',
      scoringPeriodBehavior: 'weekly', rescheduleHandling: null, doubleheaderHandling: null,
    },
    permissions: { settingsEditableByRoles: ['commissioner'], memberMovesLocked: false, inviteLinksDisabled: false, inviteCapacityOverride: false },
    intelligence: {},
  } as unknown as CanonicalLeagueRules
}

/** Team 1 has the best record, team N the worst, so seed = team number. */
function teamsFor(count: number): NflRedraftPlayoffTeamInput[] {
  return Array.from({ length: count }, (_, i) => ({
    rosterId: `t${String(i + 1).padStart(3, '0')}`,
    displayName: `Team ${i + 1}`,
    ownerId: `u${i + 1}`,
    divisionId: null,
    wins: count - i,
    losses: i,
    pointsFor: 2000 - i,
    pointsAgainst: 1000 + i,
    divisionWins: 0,
    divisionLosses: 0,
  })) as NflRedraftPlayoffTeamInput[]
}

function playToChampion(leagueTeams: number, playoffTeams: number) {
  let state: NflRedraftPlayoffRuntimeState = buildNflRedraftPlayoffRuntimeState({
    leagueId: 'league-big', seasonId: 'season-big', season: 2026, week: 14,
    rules: rulesFor(leagueTeams, playoffTeams), teams: teamsFor(leagueTeams), now: new Date('2026-07-02T12:00:00.000Z'),
  })
  const settings = state.settings
  const seeds = state.seeds.map((seed) => seed.rosterId)
  const generated = generateNflRedraftPlayoffBracket({ state, actorUserId: 'c', lockBracket: true })
  state = { ...state, bracket: generated.bracket }
  const firstRound = generated.bracket.rounds[0]!
  const byeRosterIds = firstRound.matchups.filter((m) => m.bye).flatMap((m) => [m.homeRosterId, m.awayRosterId]).filter(Boolean) as string[]
  const firstRoundGames = firstRound.matchups.filter((m) => !m.bye).map((m) => [m.homeRosterId, m.awayRosterId].sort())
  let roundsPlayed = 0
  let championRosterId: string | null = null
  for (let guard = 0; guard < 12; guard++) {
    // The home side wins every game.
    const scored: NflRedraftPlayoffRuntimeState = {
      ...state,
      bracket: {
        ...state.bracket,
        rounds: state.bracket.rounds.map((round) =>
          round.status === 'active'
            ? { ...round, matchups: round.matchups.map((m) => (m.bye ? m : { ...m, homeScore: 120, awayScore: 90, status: 'final' as const })) }
            : round,
        ),
      },
    }
    const result = advanceNflRedraftPlayoffRound({ state: scored, actorUserId: 'c' })
    expect(result.ok).toBe(true)
    if (!result.ok) break
    roundsPlayed += 1
    state = result.state
    if (result.status === 'championship_ready' || !state.bracket.rounds.some((round) => round.status === 'active')) {
      const final = finalizeNflRedraftPlayoffChampion({ state, actorUserId: 'c' })
      expect(final.ok).toBe(true)
      if (final.ok) championRosterId = final.championRosterId
      break
    }
  }
  return { settings, seeds, byeRosterIds, firstRoundGames, roundsPlayed, championRosterId, supported: settings.supported }
}

describe('playoff fields: odd sizes and up to 32 teams', () => {
  it('allows a 32-team field', () => {
    expect(MAX_PLAYOFF_TEAMS).toBe(32)
    expect(playoffRoundsForTeams(32)).toBe(5)
    expect(checkByePlan(32, naturalByePlan(32)).ok).toBe(true)
  })

  it.each([
    [10, 3], [10, 5], [12, 6], [11, 7], [12, 8], [12, 9], [16, 11], [36, 12], [34, 13], [34, 14], [36, 16], [160, 32],
  ])('a %i-team league with a %i-team field gives the byes to the top seeds and crowns a champion', (leagueTeams, playoffTeams) => {
    const run = playToChampion(leagueTeams, playoffTeams)
    const byes = firstRoundByesForTeams(playoffTeams)
    expect(run.supported).toBe(true)
    expect(run.settings.playoffTeamCount).toBe(playoffTeams)
    expect(run.seeds).toHaveLength(playoffTeams)
    // The best `byes` seeds sit out round one; nobody else does.
    expect([...run.byeRosterIds].sort()).toEqual(run.seeds.slice(0, byes).sort())
    // Everyone else plays exactly once in round one.
    const playing = run.firstRoundGames.flat()
    expect([...playing].sort()).toEqual(run.seeds.slice(byes).sort())
    expect(run.roundsPlayed).toBe(playoffRoundsForTeams(playoffTeams))
    // The home side (the better seed) wins every game, so the #1 seed takes the title.
    expect(run.championRosterId).toBe(run.seeds[0])
  })

  it('pairs best remaining seed against worst in round one of a 7-team field', () => {
    const run = playToChampion(12, 7)
    // Seed 1 sits out; 2v7, 3v6, 4v5.
    expect(run.byeRosterIds).toEqual(['t001'])
    expect(run.firstRoundGames.map((g) => g.join('-')).sort()).toEqual(['t002-t007', 't003-t006', 't004-t005'])
  })
})
