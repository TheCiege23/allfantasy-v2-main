import { describe, expect, it } from 'vitest'

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { normalizeLeagueRuntimeEventType } from '@/lib/league-runtime'
import {
  buildCanonicalRosterRuntimeState,
  buildCanonicalRosterRuntimeTeam,
  buildCanonicalRosterSectionsFromDraftedPlayers,
  buildRosterRuntimeEvent,
  getCanonicalRosterCapacity,
  planCanonicalRosterMove,
  toPersistedPlayerDataFromRosterSections,
  type RosterRuntimeSections,
} from '@/lib/roster-runtime/canonicalRosterRuntime'

const rules = {
  version: 1,
  leagueId: 'league-g35',
  generatedAtIso: '2026-07-02T12:00:00.000Z',
  source: {
    commissionerSettings: 'League',
    draftSettings: 'LeagueSettings',
    effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
    settingsSnapshotVersion: 4,
    presetKey: 'af:v2|concept=redraft|sport=NFL',
  },
  general: {
    name: 'G35 NFL Redraft',
    sport: 'NFL',
    season: 2026,
    format: 'redraft',
    variant: null,
    teamCount: 2,
    rosterSize: 8,
    lifecycleState: 'active',
    status: 'active',
    locked: false,
    emergencyPaused: false,
    timezone: 'America/New_York',
    language: 'en',
  },
  draft: {
    type: 'snake',
    rounds: 8,
    timerSeconds: 90,
    slowTimerSeconds: 3600,
    timerMode: 'per_pick',
    scheduledAtIso: null,
    orderMethod: 'manual',
    orderLocked: true,
    pickOrderRules: 'snake',
    thirdRoundReversal: false,
    autoPickEnabled: true,
    cpuAutoPick: true,
    commissionerForceAutoPickEnabled: true,
    pickTradingEnabled: true,
    importEnabled: true,
    executionMode: 'live',
    playerPool: 'all',
    rosterFillOrder: 'starter_first',
    positionFilterBehavior: 'by_eligibility',
  },
  scoring: {
    templateId: 'nfl_half_ppr',
    presetId: 'nfl_half_ppr',
    formatType: 'redraft',
    sport: 'NFL',
    activeRuleCount: 8,
    overriddenRuleCount: 0,
    activeRules: [],
  },
  roster: {
    size: 8,
    starters: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
    irSlots: 1,
    eligibleReserveStatuses: ['IR', 'OUT', 'PUP'],
    allowPreDraftMoves: true,
    preventBenchDrops: false,
    lockAllMoves: false,
  },
  waivers: {} as CanonicalLeagueRules['waivers'],
  trades: { reviewHours: 24, deadlineWeek: 10, draftPickTrading: true },
  playoffs: {} as CanonicalLeagueRules['playoffs'],
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

const validSections: RosterRuntimeSections = {
  starters: [
    { playerId: 'qb-1', playerName: 'Josh Allen', position: 'QB', team: 'BUF', gameStartIso: '2026-07-02T11:55:00.000Z' },
    { playerId: 'rb-1', playerName: 'Bijan Robinson', position: 'RB', team: 'ATL', byeWeek: 1 },
    { playerId: 'wr-1', playerName: 'Puka Nacua', position: 'WR', team: 'LAR' },
    { playerId: 'te-1', playerName: 'Trey McBride', position: 'TE', team: 'ARI' },
    { playerId: 'rb-2', playerName: 'Jahmyr Gibbs', position: 'RB', team: 'DET' },
    { playerId: 'k-1', playerName: 'Brandon Aubrey', position: 'K', team: 'DAL' },
    { playerId: 'def-1', playerName: 'Jets D/ST', position: 'DST', team: 'NYJ' },
  ],
  bench: [{ playerId: 'wr-2', playerName: 'Chris Olave', position: 'WR', team: 'NO' }],
  ir: [{ playerId: 'ir-1', playerName: 'Injured Back', position: 'RB', team: 'SEA', status: 'OUT' }],
}

describe('G35 canonical NFL redraft roster runtime', () => {
  it('builds canonical roster slots, capacity, lock state, and non-blocking bye warnings', () => {
    const state = buildCanonicalRosterRuntimeState({
      rules,
      now: new Date('2026-07-02T12:00:00.000Z'),
      scoringWeek: 1,
      teams: [{ rosterId: 'roster-1', displayName: 'Alpha', sections: validSections }],
    })

    expect(state.starterSlots.map((slot) => slot.label)).toEqual(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'])
    expect(getCanonicalRosterCapacity(rules)).toMatchObject({ starters: 7, bench: 1, active: 8, ir: 1 })
    expect(state.teams[0].validation.ok).toBe(true)
    expect(state.teams[0].lockedPlayerIds).toEqual(['qb-1'])
    expect(state.teams[0].validation.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'STARTER_ON_BYE', severity: 'warning', playerId: 'rb-1' })]),
    )
  })

  it('materializes completed draft picks into starters and bench from canonical rules', () => {
    const sections = buildCanonicalRosterSectionsFromDraftedPlayers({
      rules,
      draftedPlayers: [
        { playerId: 'pick-qb', playerName: 'Quarterback', position: 'QB' },
        { playerId: 'pick-rb', playerName: 'Runner', position: 'RB' },
        { playerId: 'pick-wr', playerName: 'Wideout', position: 'WR' },
        { playerId: 'pick-te', playerName: 'Tight End', position: 'TE' },
        { playerId: 'pick-rb2', playerName: 'Flex Runner', position: 'RB' },
        { playerId: 'pick-k', playerName: 'Kicker', position: 'K' },
        { playerId: 'pick-def', playerName: 'Defense', position: 'DEF' },
        { playerId: 'pick-wr2', playerName: 'Bench Wideout', position: 'WR' },
      ],
    })

    expect(sections.starters.map((player) => player.playerId)).toEqual([
      'pick-qb',
      'pick-rb',
      'pick-wr',
      'pick-te',
      'pick-rb2',
      'pick-k',
      'pick-def',
    ])
    expect(sections.bench.map((player) => player.playerId)).toEqual(['pick-wr2'])
    expect(sections.ir).toEqual([])
  })

  it('blocks illegal lineups before submission', () => {
    const invalid = buildCanonicalRosterRuntimeTeam({
      rules,
      now: new Date('2026-07-02T12:00:00.000Z'),
      scoringWeek: 1,
      team: {
        rosterId: 'roster-bad',
        sections: {
          starters: [
            { playerId: 'qb-1', playerName: 'Quarterback', position: 'QB' },
            { playerId: 'edge-1', playerName: 'Wrong Position', position: 'DE' },
            { playerId: 'out-1', playerName: 'Inactive Back', position: 'RB', status: 'OUT' },
          ],
          bench: [
            { playerId: 'qb-1', playerName: 'Quarterback Duplicate', position: 'QB' },
            { playerId: 'wr-3', playerName: 'Extra Bench', position: 'WR' },
          ],
          ir: [{ playerId: 'healthy-ir', playerName: 'Healthy IR', position: 'WR', status: 'healthy' }],
        },
      },
    })

    const codes = invalid.validation.issues.map((issue) => issue.code)
    expect(invalid.validation.ok).toBe(false)
    expect(codes).toEqual(
      expect.arrayContaining([
        'BENCH_OVER_LIMIT',
        'DUPLICATE_PLAYER',
        'EMPTY_REQUIRED_STARTER',
        'INACTIVE_STARTER',
        'IR_INELIGIBLE',
        'STARTER_POSITION_INELIGIBLE',
      ]),
    )
  })

  it('plans roster moves, respects player locks, and supports commissioner override', () => {
    const openFlexTeam = buildCanonicalRosterRuntimeTeam({
      rules,
      now: new Date('2026-07-02T12:00:00.000Z'),
      team: {
        rosterId: 'roster-2',
        sections: {
          starters: validSections.starters.filter((player) => player.playerId !== 'rb-2'),
          bench: [{ playerId: 'rb-2', playerName: 'Jahmyr Gibbs', position: 'RB', team: 'DET' }],
          ir: validSections.ir,
        },
      },
    })

    const move = planCanonicalRosterMove({
      rules,
      team: openFlexTeam,
      playerId: 'rb-2',
      toSection: 'starters',
      actorRole: 'manager',
      now: new Date('2026-07-02T12:00:00.000Z'),
    })
    expect(move.ok).toBe(true)
    if (move.ok) {
      expect(move.nextTeam.sections.starters.some((player) => player.playerId === 'rb-2')).toBe(true)
      expect(move.events.map((event) => event.type)).toEqual(
        expect.arrayContaining(['roster.player.started', 'lineup.starter.changed']),
      )
    }

    const lockedMove = planCanonicalRosterMove({
      rules,
      team: buildCanonicalRosterRuntimeTeam({
        rules,
        now: new Date('2026-07-02T12:00:00.000Z'),
        team: { rosterId: 'roster-1', sections: validSections },
      }),
      playerId: 'qb-1',
      toSection: 'bench',
      actorRole: 'manager',
      now: new Date('2026-07-02T12:00:00.000Z'),
    })
    expect(lockedMove).toMatchObject({ ok: false, code: 'PLAYER_LOCKED' })

    const overrideMove = planCanonicalRosterMove({
      rules,
      team: buildCanonicalRosterRuntimeTeam({
        rules,
        now: new Date('2026-07-02T12:00:00.000Z'),
        team: { rosterId: 'roster-1', sections: validSections },
      }),
      playerId: 'qb-1',
      toSection: 'bench',
      actorRole: 'commissioner',
      commissionerOverride: true,
      now: new Date('2026-07-02T12:00:00.000Z'),
    })
    expect(overrideMove.ok).toBe(true)
  })

  it('normalizes roster runtime events and persists canonical section shape', () => {
    expect(normalizeLeagueRuntimeEventType('lineup_submitted')).toBe('lineup.submitted')
    expect(normalizeLeagueRuntimeEventType('player_moved_to_ir')).toBe('roster.player.moved_to_ir')
    expect(normalizeLeagueRuntimeEventType('roster_player_benched')).toBe('roster.player.benched')

    const event = buildRosterRuntimeEvent({
      leagueId: rules.leagueId,
      type: 'player_removed_from_ir',
      occurredAt: '2026-07-02T12:03:00.000Z',
      payload: { rosterId: 'roster-1', playerId: 'ir-1' },
    })
    expect(event.type).toBe('roster.player.removed_from_ir')

    const persisted = toPersistedPlayerDataFromRosterSections({}, validSections)
    expect(persisted.players).toEqual([
      ...validSections.starters.map((player) => player.playerId),
      ...validSections.bench.map((player) => player.playerId),
      'ir-1',
    ])
    expect(persisted.starters).toEqual(validSections.starters.map((player) => player.playerId))
    expect(persisted.reserve).toEqual(['ir-1'])
    expect((persisted.roster_runtime as Record<string, unknown>).source).toBe('canonical_roster_runtime')
  })
})
