import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueFindUniqueMock = vi.hoisted(() => vi.fn())
const getDraftConfigForLeagueMock = vi.hoisted(() => vi.fn())
const getDraftUISettingsForLeagueMock = vi.hoisted(() => vi.fn())
const getLeagueScoringConfigMock = vi.hoisted(() => vi.fn())
const getWaiverConfigForLeagueMock = vi.hoisted(() => vi.fn())
const getPlayoffConfigForLeagueMock = vi.hoisted(() => vi.fn())
const getScheduleConfigForLeagueMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: leagueFindUniqueMock,
    },
  },
}))

vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: getDraftConfigForLeagueMock,
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: getDraftUISettingsForLeagueMock,
}))

vi.mock('@/lib/scoring-defaults/LeagueScoringConfigResolver', () => ({
  getLeagueScoringConfig: getLeagueScoringConfigMock,
}))

vi.mock('@/lib/waiver-defaults/WaiverConfigResolver', () => ({
  getWaiverConfigForLeague: getWaiverConfigForLeagueMock,
}))

vi.mock('@/lib/playoff-defaults/PlayoffConfigResolver', () => ({
  getPlayoffConfigForLeague: getPlayoffConfigForLeagueMock,
}))

vi.mock('@/lib/schedule-defaults/ScheduleConfigResolver', () => ({
  getScheduleConfigForLeague: getScheduleConfigForLeagueMock,
}))

import {
  buildCanonicalLeagueRulesFromResolved,
  buildCanonicalRuntimeConsumerContext,
  resolveCanonicalLeagueRules,
  toCanonicalLeagueRuntimeEvent,
  normalizeLeagueRuntimeEventType,
  type CanonicalLeagueRow,
} from '@/lib/league-runtime'
import { deriveDecisionOsSignalsFromRuntimeEvents } from '@/lib/decision-os/runtime-event-derivation'

const generatedAt = new Date('2026-07-02T12:00:00.000Z')

const baseLeague: CanonicalLeagueRow = {
  id: 'league-1',
  name: 'Canonical Redraft',
  sport: 'NFL',
  season: 2026,
  leagueType: 'redraft',
  leagueVariant: null,
  scoringPresetId: 'nfl_half_ppr',
  leagueSize: 12,
  rosterSize: 16,
  starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DST', 'K'],
  settingsSnapshotVersion: 3,
  presetKey: 'af:v2|concept=redraft|sport=NFL',
  status: 'setup',
  lifecycleState: 'pre_draft',
  timezone: 'America/New_York',
  language: 'en',
  waiverType: 'FAAB',
  waiverBudget: 100,
  waiverMinBid: 1,
  waiverProcessTime: '02:00',
  tradeReviewHours: 48,
  tradeDeadlineWeek: 10,
  draftPickTrading: true,
  playoffStartWeek: 15,
  playoffTeams: 6,
  playoffWeeksPerRound: 1,
  playoffSeedingRule: 'standard_standings',
  playoffLowerBracket: 'consolation',
  irSlots: 2,
  irAllowOut: true,
  irAllowDoubtful: true,
  allowPreDraftMoves: true,
  preventBenchDrops: false,
  lockAllMoves: false,
  disableInviteLinks: false,
  overrideInviteCapacity: false,
  aiChimmyEnabled: true,
  aiWaiverSuggestions: true,
  aiPowerRankings: true,
  leagueSettings: {
    draftDateUtc: '2026-08-24T01:00:00.000Z',
    timezone: 'America/New_York',
    autostart: false,
    cpuAutoPick: true,
    draftType: 'snake',
    pickTimerCustomValue: 90,
    rounds: 16,
    draftOrderMethod: 'manual',
    draftOrderLocked: true,
    playerPool: 'all',
    aiRosterGuidance: true,
  },
}

const draftConfig = {
  draft_type: 'snake',
  rounds: 16,
  timer_seconds: 90,
  slow_timer_seconds: 3600,
  pick_order_rules: 'snake',
  snake_or_linear: 'snake',
  third_round_reversal: false,
  autopick_behavior: 'queue-first',
  queue_size_limit: null,
  pre_draft_ranking_source: 'adp',
  roster_fill_order: 'starter_first',
  position_filter_behavior: 'by_eligibility',
  sport: 'NFL',
  variant: null,
} as const

const draftUiSettings = {
  autoPickEnabled: false,
  timerMode: 'per_pick',
  commissionerForceAutoPickEnabled: true,
  pickTradeEnabled: true,
  importEnabled: true,
  executionMode: 'live',
} as const

const scoringConfig = {
  leagueId: 'league-1',
  sport: 'NFL',
  leagueVariant: null,
  formatType: 'redraft',
  templateId: 'nfl_half_ppr',
  rules: [
    {
      statKey: 'pass_yd',
      pointsValue: 0.04,
      multiplier: 1,
      enabled: true,
      defaultPointsValue: 0.04,
      defaultEnabled: true,
      isOverridden: false,
    },
    {
      statKey: 'rec',
      pointsValue: 0.5,
      multiplier: 1,
      enabled: true,
      defaultPointsValue: 1,
      defaultEnabled: true,
      isOverridden: true,
    },
    {
      statKey: 'misc_disabled',
      pointsValue: 10,
      multiplier: 1,
      enabled: false,
      defaultPointsValue: 10,
      defaultEnabled: false,
      isOverridden: false,
    },
  ],
}

const waiverConfig = {
  waiver_type: 'FAAB',
  processing_days: [2, 5],
  processing_time_utc: '07:00',
  claim_limit_per_period: 4,
  claim_priority_behavior: 'lowest_standing',
  game_lock_behavior: 'lock_at_game_start',
  drop_lock_behavior: 'unlock_after_game',
  same_day_add_drop_rules: 'allow',
  free_agent_unlock_behavior: 'after_clear',
  continuous_waivers: true,
  max_claims_per_period: 6,
  faab_enabled: true,
  faab_budget: 100,
  faab_reset_rules: 'season',
  sport: 'NFL',
  variant: null,
  tiebreak_rule: 'reverse_standings',
  instant_fa_after_clear: false,
}

const playoffConfig = {
  playoff_team_count: 6,
  playoff_weeks: 3,
  playoff_start_week: 15,
  playoff_start_point: null,
  first_round_byes: 2,
  bracket_type: 'single_elimination',
  matchup_length: 1,
  total_rounds: 3,
  consolation_bracket_enabled: true,
  third_place_game_enabled: true,
  toilet_bowl_enabled: false,
  championship_length: 1,
  consolation_plays_for: 'consolation',
  seeding_rules: 'standard_standings',
  tiebreaker_rules: ['points_for'],
  bye_rules: 'top_two',
  reseed_behavior: 'fixed_bracket',
  standings_tiebreakers: ['wins', 'points_for'],
  sport: 'NFL',
  variant: null,
}

const scheduleConfig = {
  schedule_unit: 'week',
  regular_season_length: 14,
  matchup_frequency: 'weekly',
  matchup_cadence: 'weekly',
  schedule_cadence: 'weekly',
  schedule_generation_strategy: 'round_robin',
  playoff_transition_point: 15,
  head_to_head_behavior: 'head_to_head',
  lock_time_behavior: 'first_game',
  lock_window_behavior: 'first_game_of_week',
  scoring_period_behavior: 'full_period',
  reschedule_handling: 'use_final_time',
  doubleheader_handling: 'all_games_count',
  sport: 'NFL',
  variant: null,
}

function buildRules(overrides: Partial<CanonicalLeagueRow> = {}) {
  return buildCanonicalLeagueRulesFromResolved({
    league: { ...baseLeague, ...overrides },
    draftConfig: draftConfig as any,
    draftUiSettings,
    scoringConfig,
    waiverConfig,
    playoffConfig,
    scheduleConfig,
    generatedAt,
  })
}

describe('G33 canonical league runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindUniqueMock.mockResolvedValue(baseLeague)
    getDraftConfigForLeagueMock.mockResolvedValue(draftConfig)
    getDraftUISettingsForLeagueMock.mockResolvedValue(draftUiSettings)
    getLeagueScoringConfigMock.mockResolvedValue(scoringConfig)
    getWaiverConfigForLeagueMock.mockResolvedValue(waiverConfig)
    getPlayoffConfigForLeagueMock.mockResolvedValue(playoffConfig)
    getScheduleConfigForLeagueMock.mockResolvedValue(scheduleConfig)
  })

  it('builds canonical rules from commissioner settings and effective runtime resolvers', () => {
    const rules = buildRules()

    expect(rules).toMatchObject({
      version: 1,
      leagueId: 'league-1',
      generatedAtIso: '2026-07-02T12:00:00.000Z',
      general: {
        sport: 'NFL',
        format: 'redraft',
        teamCount: 12,
        timezone: 'America/New_York',
      },
      draft: {
        type: 'snake',
        rounds: 16,
        timerSeconds: 90,
        pickTradingEnabled: true,
        orderLocked: true,
      },
      waivers: {
        type: 'FAAB',
        faabEnabled: true,
        faabBudget: 100,
      },
      trades: {
        reviewHours: 48,
        deadlineWeek: 10,
        draftPickTrading: true,
      },
      playoffs: {
        teamCount: 6,
        firstRoundByes: 2,
      },
      schedule: {
        regularSeasonLength: 14,
        lockWindowBehavior: 'first_game_of_week',
      },
    })
    expect(rules.source.effectiveResolvers).toEqual(['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'])
    expect(rules.scoring.activeRuleCount).toBe(2)
    expect(rules.scoring.overriddenRuleCount).toBe(1)
    expect(rules.roster.eligibleReserveStatuses).toEqual(['OUT', 'DOUBTFUL'])
  })

  it('exposes stable engine consumer slices without Decision OS control fields', () => {
    const rules = buildRules()
    const context = buildCanonicalRuntimeConsumerContext(rules)

    expect(context.leagueId).toBe('league-1')
    expect(context.draft).toBe(rules.draft)
    expect(context.waivers).toBe(rules.waivers)
    expect(context.playoffs).toBe(rules.playoffs)
    expect('intelligence' in context).toBe(false)
  })

  it('normalizes existing fan-out events into canonical runtime event names', () => {
    expect(normalizeLeagueRuntimeEventType('settings_changed')).toBe('settings.updated')
    expect(normalizeLeagueRuntimeEventType('matchup_live_tick')).toBe('scoring.updated')
    expect(normalizeLeagueRuntimeEventType('trade.accepted')).toBe('trade.accepted')
    expect(normalizeLeagueRuntimeEventType('not_a_known_event')).toBe('runtime.unknown')

    const event = toCanonicalLeagueRuntimeEvent({
      leagueId: 'league-1',
      eventType: 'settings_changed',
      actorUserId: 'user-1',
      createdAt: '2026-07-02T12:15:00.000Z',
      meta: { updatedFields: ['playoffTeams'] },
    })

    expect(event).toMatchObject({
      leagueId: 'league-1',
      type: 'settings.updated',
      sourceEventType: 'settings_changed',
      actorUserId: 'user-1',
      occurredAtIso: '2026-07-02T12:15:00.000Z',
      payload: {
        meta: {
          updatedFields: ['playoffTeams'],
        },
      },
    })
  })

  it('derives Decision OS signals from canonical rules and runtime events only', () => {
    const rules = buildRules()
    const events = [
      toCanonicalLeagueRuntimeEvent({
        leagueId: 'league-1',
        eventType: 'settings_changed',
        createdAt: '2026-07-02T12:15:00.000Z',
        meta: { updatedFields: ['playoffTeams', 'waiverBudget'] },
      }),
      toCanonicalLeagueRuntimeEvent({
        leagueId: 'league-1',
        eventType: 'trade_accepted',
        createdAt: '2026-07-02T12:20:00.000Z',
      }),
      toCanonicalLeagueRuntimeEvent({
        leagueId: 'league-1',
        eventType: 'waiver_processed',
        createdAt: '2026-07-02T12:25:00.000Z',
      }),
    ]

    const result = deriveDecisionOsSignalsFromRuntimeEvents({ rules, events, generatedAt })

    expect(result.insufficientEvidence).toBe(false)
    expect(result.signals.map((signal) => signal.kind).sort()).toEqual([
      'rules_change',
      'trade_health',
      'waiver_activity',
    ])
    expect(result.signals.flatMap((signal) => signal.sourceEventTypes)).toEqual(
      expect.arrayContaining(['settings.updated', 'trade.accepted', 'waiver.processed']),
    )
    expect(result.signals.flatMap((signal) => signal.evidence.map((row) => row.label))).toEqual(
      expect.arrayContaining(['Updated fields', 'Trade rules', 'Waiver rules']),
    )
  })

  it('returns an insufficient-evidence signal instead of fabricating recommendations', () => {
    const result = deriveDecisionOsSignalsFromRuntimeEvents({
      rules: buildRules(),
      events: [
        toCanonicalLeagueRuntimeEvent({
          leagueId: 'league-1',
          eventType: 'not_a_known_event',
          createdAt: '2026-07-02T12:15:00.000Z',
        }),
      ],
      generatedAt,
    })

    expect(result.insufficientEvidence).toBe(true)
    expect(result.signals).toHaveLength(1)
    expect(result.signals[0]).toMatchObject({
      kind: 'insufficient_evidence',
      confidenceLabel: 'Low',
    })
  })

  it('records paid intelligence gates without granting access or persisting locked settings', () => {
    const rules = buildRules()

    expect(rules.intelligence.managerIntelligence.requiredPlan).toBe('pro')
    expect(rules.intelligence.managerIntelligence.requiredFeatures).toEqual(
      expect.arrayContaining(['pro_draft_ai', 'pro_waiver_ai', 'pro_trade_ai']),
    )
    expect(rules.intelligence.commissionerIntelligence.requiredPlan).toBe('commissioner')
    expect(rules.intelligence.commissionerIntelligence.enabledLeagueSettings).toEqual([
      'aiWaiverSuggestions',
      'aiPowerRankings',
    ])
    expect(rules.intelligence.commissionerIntelligence.lockedWithoutEntitlement).toEqual(
      expect.arrayContaining(['aiWaiverSuggestions', 'aiScope']),
    )
  })

  it('resolves canonical rules by composing existing runtime resolvers', async () => {
    const rules = await resolveCanonicalLeagueRules('league-1')

    expect(rules?.leagueId).toBe('league-1')
    expect(leagueFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'league-1' },
      include: { leagueSettings: true },
    })
    expect(getDraftConfigForLeagueMock).toHaveBeenCalledWith('league-1')
    expect(getDraftUISettingsForLeagueMock).toHaveBeenCalledWith('league-1')
    expect(getLeagueScoringConfigMock).toHaveBeenCalledWith('league-1')
    expect(getWaiverConfigForLeagueMock).toHaveBeenCalledWith('league-1')
    expect(getPlayoffConfigForLeagueMock).toHaveBeenCalledWith('league-1')
    expect(getScheduleConfigForLeagueMock).toHaveBeenCalledWith('league-1')
  })
})
