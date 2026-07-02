import { describe, expect, it } from 'vitest'

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import {
  buildCanonicalDraftRuntimeState,
  buildDraftRuntimeEvent,
  buildSmartDraftRecommendations,
  getDraftOrderEntry,
  validateCanonicalDraftPick,
  type CanonicalDraftRuntimeSessionInput,
  type DraftRuntimePlayer,
} from '@/lib/draft-runtime/canonicalDraftRuntime'
import { deriveDraftRuntimeIntelligence } from '@/lib/decision-os/draft-runtime-intelligence'
import {
  deriveDecisionOsSignalsFromRuntimeEvents,
} from '@/lib/decision-os/runtime-event-derivation'
import { normalizeLeagueRuntimeEventType } from '@/lib/league-runtime'

const rules = {
  version: 1,
  leagueId: 'league-1',
  generatedAtIso: '2026-07-02T12:00:00.000Z',
  source: {
    commissionerSettings: 'League',
    draftSettings: 'LeagueSettings',
    effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
    settingsSnapshotVersion: 3,
    presetKey: 'af:v2|concept=redraft|sport=NFL',
  },
  general: {
    name: 'G34 NFL Redraft',
    sport: 'NFL',
    season: 2026,
    format: 'redraft',
    variant: null,
    teamCount: 4,
    rosterSize: 6,
    lifecycleState: 'drafting',
    status: 'active',
    locked: false,
    emergencyPaused: false,
    timezone: 'America/New_York',
    language: 'en',
  },
  draft: {
    type: 'snake',
    rounds: 6,
    timerSeconds: 90,
    slowTimerSeconds: 3600,
    timerMode: 'per_pick',
    scheduledAtIso: '2026-08-25T00:00:00.000Z',
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
    overriddenRuleCount: 1,
    activeRules: [],
  },
  roster: {
    size: 6,
    starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
    irSlots: 0,
    eligibleReserveStatuses: [],
    allowPreDraftMoves: true,
    preventBenchDrops: false,
    lockAllMoves: false,
  },
  waivers: {} as CanonicalLeagueRules['waivers'],
  trades: { reviewHours: 24, deadlineWeek: 10, draftPickTrading: true },
  playoffs: {} as CanonicalLeagueRules['playoffs'],
  schedule: {} as CanonicalLeagueRules['schedule'],
  permissions: {
    settingsEditableByRoles: ['commissioner', 'co_commissioner'],
    memberMovesLocked: false,
    inviteLinksDisabled: false,
    inviteCapacityOverride: false,
  },
  intelligence: {} as CanonicalLeagueRules['intelligence'],
} as CanonicalLeagueRules

const session: CanonicalDraftRuntimeSessionInput = {
  id: 'draft-1',
  leagueId: 'league-1',
  status: 'in_progress',
  draftType: 'snake',
  rounds: 6,
  teamCount: 4,
  thirdRoundReversal: false,
  timerSeconds: 90,
  timerEndAtIso: '2026-07-02T12:01:00.000Z',
  pausedRemainingSeconds: null,
  slotOrder: [
    { slot: 1, rosterId: 'roster-1', displayName: 'Alpha' },
    { slot: 2, rosterId: 'roster-2', displayName: 'Beta' },
    { slot: 3, rosterId: 'roster-3', displayName: 'Gamma' },
    { slot: 4, rosterId: 'roster-4', displayName: 'Delta' },
  ],
  picks: [
    { overall: 1, round: 1, slot: 1, rosterId: 'roster-1', playerName: 'Bijan Robinson', position: 'RB', team: 'ATL', playerId: 'p-rb-1', source: 'user' },
    { overall: 2, round: 1, slot: 2, rosterId: 'roster-2', playerName: 'JaMarr Chase', position: 'WR', team: 'CIN', playerId: 'p-wr-1', source: 'user' },
    { overall: 3, round: 1, slot: 3, rosterId: 'roster-3', playerName: 'Breece Hall', position: 'RB', team: 'NYJ', playerId: 'p-rb-2', source: 'user' },
    { overall: 4, round: 1, slot: 4, rosterId: 'roster-4', playerName: 'Saquon Barkley', position: 'RB', team: 'PHI', playerId: 'p-rb-3', source: 'user' },
  ],
  scheduledAtIso: '2026-08-25T00:00:00.000Z',
  version: 7,
  updatedAtIso: '2026-07-02T12:00:00.000Z',
}

const availablePlayers: DraftRuntimePlayer[] = [
  {
    playerId: 'p-qb-1',
    name: 'Josh Allen',
    position: 'QB',
    team: 'BUF',
    byeWeek: 7,
    adp: 3,
    projection: 24.5,
    headshotUrl: 'https://cdn.example/josh.png',
    newsCount: 2,
  },
  {
    playerId: 'p-rb-4',
    name: 'Jahmyr Gibbs',
    position: 'RB',
    team: 'DET',
    byeWeek: 8,
    adp: 6,
    projection: 18.1,
  },
  {
    playerId: 'p-wr-2',
    name: 'Puka Nacua',
    position: 'WR',
    team: 'LAR',
    byeWeek: 10,
    adp: 9,
    projection: 17.2,
  },
  {
    playerId: 'p-te-1',
    name: 'Trey McBride',
    position: 'TE',
    team: 'ARI',
    byeWeek: 8,
    adp: 20,
    projection: 12.4,
  },
  {
    playerId: 'p-rb-5',
    name: 'Kenneth Walker',
    position: 'RB',
    team: 'SEA',
    byeWeek: 8,
    adp: 18,
    projection: 13.2,
  },
]

function buildState() {
  return buildCanonicalDraftRuntimeState({
    rules,
    session,
    now: new Date('2026-07-02T12:00:30.000Z'),
    managerStates: [
      { rosterId: 'roster-1', connected: true },
      { rosterId: 'roster-4', connected: false, queueCount: 0 },
    ],
    queueByRosterId: {
      'roster-4': [{ playerId: 'p-qb-1', playerName: 'Josh Allen', position: 'QB', rank: 1 }],
    },
  })
}

describe('G34 canonical NFL redraft draft runtime', () => {
  it('builds snake draft state, clock, manager risk, and canonical invariants', () => {
    const state = buildState()

    expect(state.currentPick).toMatchObject({
      overall: 5,
      round: 2,
      slot: 4,
      rosterId: 'roster-4',
      displayName: 'Delta',
    })
    expect(state.clock).toMatchObject({ status: 'running', remainingSeconds: 30 })
    expect(state.draftOrder[4]).toMatchObject({ overall: 5, slot: 4 })
    expect(state.disconnectedRosterIds).toEqual(['roster-4'])
    expect(state.runtimeInvariants.some((item) => item.code === 'MANAGERS_DISCONNECTED')).toBe(true)
  })

  it('uses the canonical third-round reversal draft order', () => {
    const slotOrder = session.slotOrder
    const roundOpeningSlots = [1, 5, 9, 13, 17].map((overall) =>
      getDraftOrderEntry({
        overall,
        teamCount: 4,
        draftType: 'snake',
        thirdRoundReversal: true,
        slotOrder,
      }).slot,
    )

    expect(roundOpeningSlots).toEqual([1, 4, 4, 1, 4])
  })

  it('validates picks server-side against canonical draft rules', () => {
    const state = buildState()
    const valid = validateCanonicalDraftPick({
      rules,
      state,
      rosterId: 'roster-4',
      player: availablePlayers[0],
      actorRole: 'manager',
      source: 'user',
    })
    expect(valid).toMatchObject({ ok: true, code: 'OK' })

    const wrongRoster = validateCanonicalDraftPick({
      rules,
      state,
      rosterId: 'roster-1',
      player: availablePlayers[0],
      actorRole: 'manager',
      source: 'user',
    })
    expect(wrongRoster).toMatchObject({ ok: false, code: 'NOT_ON_CLOCK' })

    const duplicate = validateCanonicalDraftPick({
      rules,
      state,
      rosterId: 'roster-4',
      player: { playerId: 'p-rb-1', name: 'Bijan Robinson', position: 'RB' },
      actorRole: 'manager',
    })
    expect(duplicate).toMatchObject({ ok: false, code: 'DUPLICATE_PLAYER' })

    const gated = validateCanonicalDraftPick({
      rules,
      state,
      rosterId: 'roster-4',
      player: availablePlayers[0],
      actorRole: 'system',
      source: 'substitute_manager',
      entitledFeatures: [],
    })
    expect(gated).toMatchObject({ ok: false, code: 'PREMIUM_SUBSTITUTE_MANAGER_REQUIRED' })
  })

  it('creates deterministic Smart Recommendations with evidence, risk, alternatives, and Draft Flow signals', () => {
    const state = buildState()
    const recs = buildSmartDraftRecommendations({
      rules,
      state,
      availablePlayers,
      rosterId: 'roster-4',
      generatedAt: new Date('2026-07-02T12:00:30.000Z'),
    })

    expect(recs.insufficientEvidence).toBe(false)
    expect(recs.recommendations[0]).toMatchObject({
      valueLabel: 'value',
      risk: 'low',
      confidenceLabel: 'High',
    })
    expect(recs.recommendations[0].evidence.join(' ')).toContain('Market rank')
    expect(recs.recommendations[0].alternatives.length).toBeGreaterThan(0)
    expect(recs.flowSignals.some((signal) => signal.kind === 'position_run')).toBe(true)
    expect(recs.flowSignals.some((signal) => signal.kind === 'scarcity')).toBe(true)
  })

  it('normalizes G34 draft events and derives Decision OS evidence from them', () => {
    expect(normalizeLeagueRuntimeEventType('draft_auto_pick')).toBe('draft.autopick')
    expect(normalizeLeagueRuntimeEventType('substitute_manager_pick')).toBe('draft.substitute_pick')
    expect(normalizeLeagueRuntimeEventType('draft_trade_opportunity_generated')).toBe('draft.trade_opportunity.generated')

    const events = [
      buildDraftRuntimeEvent({
        leagueId: 'league-1',
        type: 'draft_auto_pick',
        occurredAt: '2026-07-02T12:01:00.000Z',
        payload: { rosterId: 'roster-4', playerName: 'Josh Allen' },
      }),
      buildDraftRuntimeEvent({
        leagueId: 'league-1',
        type: 'draft_recommendation_viewed',
        occurredAt: '2026-07-02T12:01:10.000Z',
        payload: { rosterId: 'roster-4' },
      }),
    ]

    const derived = deriveDecisionOsSignalsFromRuntimeEvents({ rules, events, generatedAt: new Date('2026-07-02T12:02:00.000Z') })
    expect(derived.insufficientEvidence).toBe(false)
    expect(derived.signals.flatMap((signal) => signal.sourceEventTypes)).toEqual(
      expect.arrayContaining(['draft.autopick', 'draft.recommendation.viewed']),
    )
    expect(derived.signals.flatMap((signal) => signal.evidence.map((row) => row.label))).toContain('Draft rules')
  })

  it('derives Commissioner Intelligence and Manager Intelligence from the same runtime state', () => {
    const state = buildState()
    const recommendations = buildSmartDraftRecommendations({
      rules,
      state,
      availablePlayers,
      rosterId: 'roster-4',
      generatedAt: new Date('2026-07-02T12:00:30.000Z'),
    })
    const intelligence = deriveDraftRuntimeIntelligence({
      rules,
      state,
      recommendations,
      events: [
        buildDraftRuntimeEvent({
          leagueId: 'league-1',
          type: 'draft.manager.disconnected',
          occurredAt: '2026-07-02T12:00:30.000Z',
          payload: { rosterId: 'roster-4' },
        }),
      ],
      generatedAt: new Date('2026-07-02T12:02:00.000Z'),
    })

    expect(intelligence.commissioner.map((card) => card.title)).toEqual(
      expect.arrayContaining(['Draft Readiness', 'Draft Health', 'Offline Manager Risk', 'Commissioner Action Center']),
    )
    expect(intelligence.manager.map((card) => card.title)).toEqual(
      expect.arrayContaining(['Best Available', 'Roster Need', 'Draft Value', 'Position Run Alerts', 'Team Construction', 'Trade-Up Opportunities']),
    )
    expect(intelligence.manager.find((card) => card.title === 'Best Available')?.summary).toContain('Smart Recommendation')
  })
})
