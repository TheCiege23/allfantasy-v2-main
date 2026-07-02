import { describe, expect, it } from 'vitest'

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { normalizeLeagueRuntimeEventType } from '@/lib/league-runtime'
import {
  buildCanonicalScheduleRuntimeState,
  buildScheduleGeneratedEvents,
  generateCanonicalRegularSeasonSchedule,
  planCanonicalScheduleWeekTransition,
  type ScheduleRuntimeMatchupInput,
  type ScheduleRuntimeTeamInput,
} from '@/lib/schedule-runtime/canonicalScheduleRuntime'

const rules = {
  version: 1,
  leagueId: 'league-g36',
  generatedAtIso: '2026-07-02T12:00:00.000Z',
  source: {
    commissionerSettings: 'League',
    draftSettings: 'LeagueSettings',
    effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
    settingsSnapshotVersion: 5,
    presetKey: 'af:v2|concept=redraft|sport=NFL',
  },
  general: {
    name: 'G36 NFL Redraft',
    sport: 'NFL',
    season: 2026,
    format: 'redraft',
    variant: null,
    teamCount: 4,
    rosterSize: 8,
    lifecycleState: 'active',
    status: 'active',
    locked: false,
    emergencyPaused: false,
    timezone: 'America/New_York',
    language: 'en',
  },
  draft: {} as CanonicalLeagueRules['draft'],
  scoring: {} as CanonicalLeagueRules['scoring'],
  roster: { size: 8, starters: ['QB'], irSlots: 0, eligibleReserveStatuses: [], allowPreDraftMoves: true, preventBenchDrops: false, lockAllMoves: false },
  waivers: {} as CanonicalLeagueRules['waivers'],
  trades: { reviewHours: 24, deadlineWeek: 10, draftPickTrading: true },
  playoffs: {
    teamCount: 2,
    startWeek: 4,
    standingsTiebreakers: ['win_pct', 'points_for', 'points_against'],
  },
  schedule: {
    unit: 'week',
    regularSeasonLength: 3,
    matchupFrequency: 'weekly',
    matchupCadence: 'weekly',
    generationStrategy: 'round_robin',
    playoffTransitionPoint: 4,
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

const teams: ScheduleRuntimeTeamInput[] = [
  { rosterId: 'alpha', displayName: 'Alpha', divisionId: 'east', divisionName: 'East' },
  { rosterId: 'bravo', displayName: 'Bravo', divisionId: 'east', divisionName: 'East' },
  { rosterId: 'charlie', displayName: 'Charlie', divisionId: 'west', divisionName: 'West' },
  { rosterId: 'delta', displayName: 'Delta', divisionId: 'west', divisionName: 'West' },
]

describe('G36 canonical NFL redraft schedule runtime', () => {
  it('generates an even-team regular season with every team scheduled once per week', () => {
    const generated = generateCanonicalRegularSeasonSchedule({ rules, teams })

    expect(generated.matchups).toHaveLength(6)
    for (let week = 1; week <= 3; week += 1) {
      const rosterIds = generated.matchups
        .filter((matchup) => matchup.week === week)
        .flatMap((matchup) => [matchup.homeRosterId, matchup.awayRosterId])
        .filter((id): id is string => Boolean(id))
        .sort()
      expect(rosterIds).toEqual(['alpha', 'bravo', 'charlie', 'delta'])
    }
    expect(generated.validationIssues.some((issue) => issue.severity === 'blocking')).toBe(false)
  })

  it('assigns deterministic byes for odd-team leagues without duplicating teams', () => {
    const oddTeams = [...teams, { rosterId: 'echo', displayName: 'Echo', divisionId: 'west', divisionName: 'West' }]
    const generated = generateCanonicalRegularSeasonSchedule({
      rules: { ...rules, schedule: { ...rules.schedule, regularSeasonLength: 5, playoffTransitionPoint: 6 } },
      teams: oddTeams,
    })

    const byes = generated.matchups.filter((matchup) => matchup.bye)
    expect(byes).toHaveLength(5)
    expect(byes.map((matchup) => matchup.homeRosterId).sort()).toEqual(['alpha', 'bravo', 'charlie', 'delta', 'echo'])
    for (let week = 1; week <= 5; week += 1) {
      const rosterIds = generated.matchups
        .filter((matchup) => matchup.week === week)
        .flatMap((matchup) => [matchup.homeRosterId, matchup.awayRosterId])
        .filter((id): id is string => Boolean(id))
      expect(new Set(rosterIds).size).toBe(5)
    }
    expect(generated.validationIssues.map((issue) => issue.code)).toContain('ODD_TEAM_BYES_ASSIGNED')
  })

  it('prioritizes division matchups when divisions are available', () => {
    const generated = generateCanonicalRegularSeasonSchedule({ rules, teams })
    const weekOne = generated.matchups.filter((matchup) => matchup.week === 1)

    expect(weekOne).toHaveLength(2)
    expect(weekOne.every((matchup) => matchup.divisionGame)).toBe(true)
    expect(generated.validationIssues.map((issue) => issue.code)).toContain('DIVISION_SCHEDULE_PRESENT')
  })

  it('initializes and recalculates standings from finalized matchup scores only', () => {
    const persisted: ScheduleRuntimeMatchupInput[] = [
      { id: 'm1', week: 1, homeRosterId: 'alpha', awayRosterId: 'bravo', homeScore: 101.2, awayScore: 90, status: 'final' },
      { id: 'm2', week: 1, homeRosterId: 'charlie', awayRosterId: 'delta', homeScore: 88, awayScore: 88, status: 'completed' },
      { id: 'm3', week: 2, homeRosterId: 'alpha', awayRosterId: 'charlie', homeScore: 80, awayScore: 100, status: 'final' },
      { id: 'm4', week: 2, homeRosterId: 'bravo', awayRosterId: 'delta', homeScore: 0, awayScore: 0, status: 'scheduled' },
      { id: 'm5', week: 3, homeRosterId: 'delta', awayRosterId: null, status: 'scheduled' },
    ]
    const state = buildCanonicalScheduleRuntimeState({
      rules,
      teams,
      persistedMatchups: persisted,
      currentWeek: 2,
      status: 'active',
    })

    const alpha = state.standings.find((row) => row.rosterId === 'alpha')
    const charlie = state.standings.find((row) => row.rosterId === 'charlie')
    const delta = state.standings.find((row) => row.rosterId === 'delta')

    expect(alpha).toMatchObject({ wins: 1, losses: 1, ties: 0, pointsFor: 181.2, pointsAgainst: 190 })
    expect(charlie).toMatchObject({ wins: 1, losses: 0, ties: 1, winPct: 0.75, streak: 'W1' })
    expect(delta?.byeWeeks).toEqual([3])
    expect(state.playoffQualificationSnapshot.seeds.map((seed) => seed.rosterId)).toEqual(['charlie', 'alpha'])
  })

  it('blocks week progression before readiness and emits deterministic events when complete', () => {
    const generatedState = buildCanonicalScheduleRuntimeState({
      rules,
      teams,
      currentWeek: 1,
      status: 'active',
    })

    expect(
      planCanonicalScheduleWeekTransition({
        state: generatedState,
        action: 'open_week',
        week: 1,
        draftCompleted: false,
        rosterReady: true,
      }),
    ).toMatchObject({ ok: false, code: 'DRAFT_NOT_COMPLETE' })

    expect(
      planCanonicalScheduleWeekTransition({
        state: generatedState,
        action: 'advance_week',
        week: 1,
        draftCompleted: true,
        rosterReady: true,
      }),
    ).toMatchObject({ ok: false, code: 'INCOMPLETE_WEEK' })

    const completedState = buildCanonicalScheduleRuntimeState({
      rules,
      teams,
      currentWeek: 1,
      status: 'active',
      persistedMatchups: [
        { id: 'm1', week: 1, homeRosterId: 'alpha', awayRosterId: 'bravo', homeScore: 99, awayScore: 80, status: 'final' },
        { id: 'm2', week: 1, homeRosterId: 'charlie', awayRosterId: 'delta', homeScore: 91, awayScore: 90, status: 'completed' },
      ],
    })
    const transition = planCanonicalScheduleWeekTransition({
      state: completedState,
      action: 'advance_week',
      week: 1,
      draftCompleted: true,
      rosterReady: true,
    })

    expect(transition).toMatchObject({ ok: true, currentWeek: 2, nextStatus: 'active' })
    if (transition.ok) {
      expect(transition.events.map((event) => event.type)).toEqual(
        expect.arrayContaining(['schedule.week.completed', 'standings.recalculated', 'schedule.week.opened']),
      )
    }
  })

  it('normalizes schedule runtime events for future League Intelligence consumers', () => {
    expect(normalizeLeagueRuntimeEventType('schedule_generated')).toBe('schedule.generated')
    expect(normalizeLeagueRuntimeEventType('week_completed')).toBe('schedule.week.completed')
    expect(normalizeLeagueRuntimeEventType('playoff_qualification_snapshot_updated')).toBe(
      'playoffs.qualification_snapshot.updated',
    )

    const state = buildCanonicalScheduleRuntimeState({ rules, teams, currentWeek: 1, status: 'active' })
    const events = buildScheduleGeneratedEvents({ state, actorUserId: 'commissioner-1' })
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['schedule.generated', 'matchup.created', 'division.assigned', 'playoffs.qualification_snapshot.updated']),
    )
  })
})
