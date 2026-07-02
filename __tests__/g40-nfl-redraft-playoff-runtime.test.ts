import { describe, expect, it } from 'vitest'

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { normalizeLeagueRuntimeEventType } from '@/lib/league-runtime'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffRuntimeState,
  type NflRedraftPlayoffTeamInput,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'

const rules = {
  version: 1,
  leagueId: 'league-g40',
  generatedAtIso: '2026-07-02T12:00:00.000Z',
  source: {
    commissionerSettings: 'League',
    draftSettings: 'LeagueSettings',
    effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
    settingsSnapshotVersion: 7,
    presetKey: 'af:v2|concept=redraft|sport=NFL',
  },
  general: {
    name: 'G40 NFL Redraft',
    sport: 'NFL',
    season: 2026,
    format: 'redraft',
    variant: null,
    teamCount: 8,
    rosterSize: 16,
    lifecycleState: 'active',
    status: 'active',
    locked: false,
    emergencyPaused: false,
    timezone: 'America/New_York',
    language: 'en',
  },
  draft: {} as CanonicalLeagueRules['draft'],
  scoring: {} as CanonicalLeagueRules['scoring'],
  roster: {} as CanonicalLeagueRules['roster'],
  waivers: {} as CanonicalLeagueRules['waivers'],
  trades: {} as CanonicalLeagueRules['trades'],
  playoffs: {
    teamCount: 6,
    startWeek: 15,
    firstRoundByes: 2,
    consolationBracketEnabled: true,
    thirdPlaceGameEnabled: false,
    seedingRules: 'division_winners_then_standings',
    tiebreakerRules: ['win_pct', 'wins', 'division_record', 'points_for', 'points_against'],
    byeRules: 'top_seed_byes',
    reseedBehavior: 'reseed_after_each_round',
    standingsTiebreakers: ['win_pct', 'wins', 'division_record', 'points_for', 'points_against'],
  },
  schedule: {
    unit: 'week',
    regularSeasonLength: 14,
    matchupFrequency: 'weekly',
    matchupCadence: 'weekly',
    generationStrategy: 'round_robin',
    playoffTransitionPoint: 15,
    headToHeadBehavior: 'standard',
    lockTimeBehavior: 'per_player_kickoff',
    lockWindowBehavior: 'nfl_week',
    scoringPeriodBehavior: 'weekly',
    rescheduleHandling: null,
    doubleheaderHandling: null,
  },
  permissions: {
    settingsEditableByRoles: ['commissioner', 'co_commissioner'],
    memberMovesLocked: false,
    inviteLinksDisabled: false,
    inviteCapacityOverride: false,
  },
  intelligence: {} as CanonicalLeagueRules['intelligence'],
} as CanonicalLeagueRules

const teams: NflRedraftPlayoffTeamInput[] = [
  { rosterId: 'alpha', displayName: 'Alpha', ownerId: 'u-alpha', divisionId: 'east', wins: 11, losses: 3, pointsFor: 1540, pointsAgainst: 1280, divisionWins: 5, divisionLosses: 1 },
  { rosterId: 'bravo', displayName: 'Bravo', ownerId: 'u-bravo', divisionId: 'east', wins: 10, losses: 4, pointsFor: 1502, pointsAgainst: 1301, divisionWins: 4, divisionLosses: 2 },
  { rosterId: 'charlie', displayName: 'Charlie', ownerId: 'u-charlie', divisionId: 'west', wins: 9, losses: 5, pointsFor: 1488, pointsAgainst: 1320, divisionWins: 5, divisionLosses: 1 },
  { rosterId: 'delta', displayName: 'Delta', ownerId: 'u-delta', divisionId: 'west', wins: 9, losses: 5, pointsFor: 1440, pointsAgainst: 1350, divisionWins: 3, divisionLosses: 3 },
  { rosterId: 'echo', displayName: 'Echo', ownerId: 'u-echo', divisionId: 'east', wins: 8, losses: 6, pointsFor: 1398, pointsAgainst: 1375, divisionWins: 3, divisionLosses: 3 },
  { rosterId: 'foxtrot', displayName: 'Foxtrot', ownerId: 'u-foxtrot', divisionId: 'west', wins: 8, losses: 6, pointsFor: 1370, pointsAgainst: 1388, divisionWins: 2, divisionLosses: 4 },
  { rosterId: 'golf', displayName: 'Golf', ownerId: 'u-golf', divisionId: 'east', wins: 7, losses: 7, pointsFor: 1330, pointsAgainst: 1390, divisionWins: 2, divisionLosses: 4 },
  { rosterId: 'hotel', displayName: 'Hotel', ownerId: 'u-hotel', divisionId: 'west', wins: 6, losses: 8, pointsFor: 1290, pointsAgainst: 1410, divisionWins: 1, divisionLosses: 5 },
]

function baseState() {
  return buildNflRedraftPlayoffRuntimeState({
    leagueId: 'league-g40',
    seasonId: 'season-g40',
    season: 2026,
    week: 15,
    rules,
    teams,
    now: new Date('2026-07-02T12:00:00.000Z'),
  })
}

function withBracket(state: NflRedraftPlayoffRuntimeState): NflRedraftPlayoffRuntimeState {
  const generated = generateNflRedraftPlayoffBracket({ state, actorUserId: 'commissioner', lockBracket: true })
  return { ...state, bracket: generated.bracket }
}

function scoreActiveRound(state: NflRedraftPlayoffRuntimeState, baseScore: number): NflRedraftPlayoffRuntimeState {
  return {
    ...state,
    bracket: {
      ...state.bracket,
      rounds: state.bracket.rounds.map((round) =>
        round.status === 'active'
          ? {
              ...round,
              matchups: round.matchups.map((matchup, index) =>
                matchup.bye
                  ? matchup
                  : {
                      ...matchup,
                      homeScore: baseScore + index,
                      awayScore: baseScore - 8 - index,
                      status: 'final',
                    },
              ),
            }
          : round,
      ),
    },
  }
}

describe('G40 canonical NFL redraft playoff runtime', () => {
  it('calculates deterministic qualification, seeds, byes, and bracket events', () => {
    const state = baseState()
    expect(state.settings).toMatchObject({
      playoffTeamCount: 6,
      bracketSize: 8,
      firstRoundByes: 2,
      roundCount: 3,
      reseedAfterEachRound: true,
      consolationEnabled: true,
    })
    expect(state.seeds).toHaveLength(6)
    expect(state.seeds.map((seed) => seed.rosterId)).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'])
    expect(state.seeds.filter((seed) => seed.qualifiedBy === 'division').map((seed) => seed.rosterId)).toEqual(['alpha', 'charlie'])
    expect(state.eliminatedRosterIds).toEqual(['golf', 'hotel'])

    const generated = generateNflRedraftPlayoffBracket({ state, actorUserId: 'commissioner', lockBracket: true })
    expect(generated.bracket.rounds).toHaveLength(3)
    expect(generated.bracket.rounds[0]?.matchups.filter((matchup) => matchup.bye)).toHaveLength(2)
    expect(generated.bracket.consolationRounds[0]?.matchups).toHaveLength(1)
    expect(generated.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'playoffs.qualification.calculated',
        'playoffs.seeds.updated',
        'playoffs.bracket.generated',
        'playoffs.bracket.locked',
        'playoffs.consolation.generated',
        'playoffs.championship.matchup.created',
      ]),
    )
  })

  it('advances rounds, reseeds winners, crowns a champion, and records final standings', () => {
    const generatedState = withBracket(baseState())

    const roundOne = advanceNflRedraftPlayoffRound({
      state: scoreActiveRound(generatedState, 120),
      actorUserId: 'commissioner',
    })
    expect(roundOne.ok).toBe(true)
    if (!roundOne.ok) return
    expect(roundOne.status).toBe('round_complete')
    expect(roundOne.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['playoffs.advancement', 'playoffs.team.advanced', 'playoffs.team.eliminated', 'playoffs.reseeded', 'playoffs.round.opened']),
    )
    expect(roundOne.state.bracket.rounds[1]?.status).toBe('active')

    const semifinal = advanceNflRedraftPlayoffRound({
      state: scoreActiveRound(roundOne.state, 130),
      actorUserId: 'commissioner',
    })
    expect(semifinal.ok).toBe(true)
    if (!semifinal.ok) return
    expect(semifinal.state.bracket.rounds[2]?.status).toBe('active')

    const championship = advanceNflRedraftPlayoffRound({
      state: scoreActiveRound(semifinal.state, 140),
      actorUserId: 'commissioner',
    })
    expect(championship.ok).toBe(true)
    if (!championship.ok) return
    expect(championship.status).toBe('championship_ready')
    expect(championship.state.bracket.rounds[2]?.status).toBe('completed')

    const finalized = finalizeNflRedraftPlayoffChampion({
      state: championship.state,
      actorUserId: 'commissioner',
    })
    expect(finalized.ok).toBe(true)
    if (!finalized.ok) return
    expect(finalized.championRosterId).toBeTruthy()
    expect(finalized.finalStandings[0]).toMatchObject({ champion: true, finish: 1 })
    expect(finalized.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['playoffs.champion.crowned', 'playoffs.final_standings.recorded', 'season.completed']),
    )
  })

  it('normalizes G40 playoff event aliases', () => {
    expect(normalizeLeagueRuntimeEventType('playoff_bracket_generated')).toBe('playoffs.bracket.generated')
    expect(normalizeLeagueRuntimeEventType('playoff_team_advanced')).toBe('playoffs.team.advanced')
    expect(normalizeLeagueRuntimeEventType('consolation_bracket_generated')).toBe('playoffs.consolation.generated')
    expect(normalizeLeagueRuntimeEventType('champion_crowned')).toBe('playoffs.champion.crowned')
    expect(normalizeLeagueRuntimeEventType('commissioner_playoff_override')).toBe('commissioner.playoff_override')
  })
})
