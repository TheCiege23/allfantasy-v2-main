import { describe, expect, it } from 'vitest'

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { normalizeLeagueRuntimeEventType } from '@/lib/league-runtime'
import {
  buildNflRedraftTradeRuntimeState,
  buildTradeLifecycleEvents,
  executeNflRedraftTrade,
  validateNflRedraftTradeProposal,
  type NflRedraftTradeAssetInput,
  type NflRedraftTradeRosterInput,
} from '@/lib/trade-runtime/canonicalNflRedraftTradeRuntime'

const rules = {
  version: 1,
  leagueId: 'league-g39',
  generatedAtIso: '2026-07-02T12:00:00.000Z',
  source: {
    commissionerSettings: 'League',
    draftSettings: 'LeagueSettings',
    effectiveResolvers: ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'],
    settingsSnapshotVersion: 1,
    presetKey: 'af:v2|concept=redraft|sport=NFL',
  },
  general: {
    name: 'G39 NFL Redraft',
    sport: 'NFL',
    season: 2026,
    format: 'redraft',
    variant: null,
    teamCount: 2,
    rosterSize: 4,
    lifecycleState: 'active',
    status: 'active',
    locked: false,
    emergencyPaused: false,
    timezone: 'America/New_York',
    language: 'en',
  },
  draft: {
    type: 'snake',
    rounds: 4,
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
    activeRuleCount: 0,
    overriddenRuleCount: 0,
    activeRules: [],
  },
  roster: {
    size: 4,
    starters: ['QB', 'RB'],
    irSlots: 0,
    eligibleReserveStatuses: [],
    allowPreDraftMoves: true,
    preventBenchDrops: false,
    lockAllMoves: false,
  },
  waivers: {} as CanonicalLeagueRules['waivers'],
  trades: { reviewHours: 48, deadlineWeek: 10, draftPickTrading: true },
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

const alpha: NflRedraftTradeRosterInput = {
  rosterId: 'alpha',
  displayName: 'Alpha',
  ownerId: 'user-alpha',
  faabBalance: 100,
  waiverPriority: 1,
  players: [
    { playerId: 'a-qb', playerName: 'Alpha QB', position: 'QB', sport: 'NFL', slotType: 'QB' },
    { playerId: 'a-rb', playerName: 'Alpha RB', position: 'RB', sport: 'NFL', slotType: 'RB' },
  ],
}

const beta: NflRedraftTradeRosterInput = {
  rosterId: 'beta',
  displayName: 'Beta',
  ownerId: 'user-beta',
  faabBalance: 40,
  waiverPriority: 2,
  players: [
    { playerId: 'b-wr', playerName: 'Beta WR', position: 'WR', sport: 'NFL', slotType: 'BENCH' },
    { playerId: 'b-te', playerName: 'Beta TE', position: 'TE', sport: 'NFL', slotType: 'BENCH' },
  ],
}

function state(overrides?: {
  week?: number
  rules?: CanonicalLeagueRules
  rosters?: NflRedraftTradeRosterInput[]
  assets?: NflRedraftTradeAssetInput[]
  pickInventorySupported?: boolean
}) {
  return buildNflRedraftTradeRuntimeState({
    leagueId: 'league-g39',
    seasonId: 'season-g39',
    season: 2026,
    week: overrides?.week ?? 6,
    rules: overrides?.rules ?? rules,
    rosters: overrides?.rosters ?? [alpha, beta],
    proposals: [
      {
        proposalId: 'trade-1',
        proposerRosterId: 'alpha',
        receiverRosterId: 'beta',
        status: 'pending',
        vetoMode: 'commissioner',
        vetoThreshold: 2,
        createdAtIso: '2026-07-02T12:00:00.000Z',
        expiresAtIso: '2026-07-03T12:00:00.000Z',
        assets: overrides?.assets ?? [
          { fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'player', playerId: 'a-rb', playerName: 'Alpha RB' },
          { fromRosterId: 'beta', toRosterId: 'alpha', assetType: 'player', playerId: 'b-wr', playerName: 'Beta WR' },
          { fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'faab', metadata: { amount: 15 } },
        ],
      },
    ],
    activeRosterLimit: 4,
    pickInventorySupported: overrides?.pickInventorySupported ?? false,
    now: new Date('2026-07-02T12:00:00.000Z'),
  })
}

describe('G39 canonical NFL redraft trade runtime', () => {
  it('validates ownership, duplicate players, locked players, deadline, and FAAB', () => {
    const base = state()
    expect(
      validateNflRedraftTradeProposal({
        state: base,
        proposerRosterId: 'alpha',
        receiverRosterId: 'beta',
        assets: [{ fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'player', playerId: 'b-wr' }],
      }),
    ).toMatchObject({ ok: false, code: 'PLAYER_NOT_OWNED' })

    expect(
      validateNflRedraftTradeProposal({
        state: base,
        proposerRosterId: 'alpha',
        receiverRosterId: 'beta',
        assets: [
          { fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'player', playerId: 'a-rb' },
          { fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'player', playerId: 'a-rb' },
        ],
      }),
    ).toMatchObject({ ok: false, code: 'DUPLICATE_ASSET' })

    const locked = state({
      rosters: [
        { ...alpha, players: alpha.players.map((player) => (player.playerId === 'a-rb' ? { ...player, isLocked: true } : player)) },
        beta,
      ],
    })
    expect(
      validateNflRedraftTradeProposal({
        state: locked,
        proposerRosterId: 'alpha',
        receiverRosterId: 'beta',
        assets: [{ fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'player', playerId: 'a-rb' }],
      }),
    ).toMatchObject({ ok: false, code: 'LOCKED_PLAYER' })

    expect(
      validateNflRedraftTradeProposal({
        state: state({ week: 11 }),
        proposerRosterId: 'alpha',
        receiverRosterId: 'beta',
        assets: [{ fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'player', playerId: 'a-rb' }],
      }),
    ).toMatchObject({ ok: false, code: 'TRADE_DEADLINE_PASSED' })

    expect(
      validateNflRedraftTradeProposal({
        state: base,
        proposerRosterId: 'alpha',
        receiverRosterId: 'beta',
        assets: [{ fromRosterId: 'beta', toRosterId: 'alpha', assetType: 'faab', metadata: { amount: 99 } }],
      }),
    ).toMatchObject({ ok: false, code: 'INSUFFICIENT_FAAB' })
  })

  it('executes accepted player and FAAB trades with deterministic events and roster impact', () => {
    const result = executeNflRedraftTrade({
      state: state(),
      proposalId: 'trade-1',
      actorUserId: 'user-beta',
      now: new Date('2026-07-02T13:00:00.000Z'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const alphaTeam = result.teams.find((team) => team.rosterId === 'alpha')
    const betaTeam = result.teams.find((team) => team.rosterId === 'beta')
    expect(alphaTeam?.players.map((player) => player.playerId)).toEqual(expect.arrayContaining(['a-qb', 'b-wr']))
    expect(alphaTeam?.players.map((player) => player.playerId)).not.toContain('a-rb')
    expect(alphaTeam?.faabBalance).toBe(85)
    expect(betaTeam?.faabBalance).toBe(55)
    expect(result.transaction.type).toBe('trade_processed')
    expect(result.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['trade.accepted', 'trade.executed', 'trade.processed', 'trade.transaction.recorded']),
    )
  })

  it('blocks roster overflow after uneven trades', () => {
    const fullBeta = {
      ...beta,
      players: [
        ...beta.players,
        { playerId: 'b-qb', playerName: 'Beta QB', position: 'QB', sport: 'NFL', slotType: 'BENCH' },
        { playerId: 'b-rb', playerName: 'Beta RB', position: 'RB', sport: 'NFL', slotType: 'BENCH' },
      ],
    }
    const validation = validateNflRedraftTradeProposal({
      state: state({ rosters: [alpha, fullBeta] }),
      proposerRosterId: 'alpha',
      receiverRosterId: 'beta',
      assets: [{ fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'player', playerId: 'a-rb' }],
    })
    expect(validation).toMatchObject({ ok: false, code: 'ROSTER_LIMIT' })
  })

  it('records enabled redraft draft picks as reference-only when no pick inventory is available', () => {
    const validation = validateNflRedraftTradeProposal({
      state: state(),
      proposerRosterId: 'alpha',
      receiverRosterId: 'beta',
      assets: [{ fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'draft_pick', pickSeason: 2027, pickRound: 2 }],
    })
    expect(validation.ok).toBe(true)
    if (validation.ok) {
      expect(validation.warnings).toContain('Draft pick asset recorded as reference-only; no redraft pick inventory was available to mutate.')
    }

    const disabledRules = {
      ...rules,
      draft: { ...rules.draft, pickTradingEnabled: false },
      trades: { ...rules.trades, draftPickTrading: false },
    } as CanonicalLeagueRules
    expect(
      validateNflRedraftTradeProposal({
        state: state({ rules: disabledRules }),
        proposerRosterId: 'alpha',
        receiverRosterId: 'beta',
        assets: [{ fromRosterId: 'alpha', toRosterId: 'beta', assetType: 'draft_pick', pickSeason: 2027, pickRound: 2 }],
      }),
    ).toMatchObject({ ok: false, code: 'DRAFT_PICK_TRADING_DISABLED' })
  })

  it('normalizes full G39 trade lifecycle event names', () => {
    expect(normalizeLeagueRuntimeEventType('trade_cancelled')).toBe('trade.cancelled')
    expect(normalizeLeagueRuntimeEventType('trade_executed')).toBe('trade.executed')
    expect(normalizeLeagueRuntimeEventType('league_vote_cast')).toBe('trade.league_vote.cast')
    expect(normalizeLeagueRuntimeEventType('commissioner_trade_override')).toBe('commissioner.trade_override')

    const events = buildTradeLifecycleEvents({
      state: state(),
      proposalId: 'trade-1',
      type: 'league_vote_passed',
      actorUserId: 'user-voter',
      now: new Date('2026-07-02T14:00:00.000Z'),
    })
    expect(events[0]).toMatchObject({
      type: 'trade.league_vote.passed',
      actorUserId: 'user-voter',
      payload: { seasonId: 'season-g39', proposalId: 'trade-1' },
    })
  })
})
