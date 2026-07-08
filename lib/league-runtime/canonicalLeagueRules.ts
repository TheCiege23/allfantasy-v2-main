import { prisma } from '@/lib/prisma'
import {
  getDraftConfigForLeague,
  type DraftRoomConfig,
} from '@/lib/draft-defaults/DraftRoomConfigResolver'
import {
  getDraftUISettingsForLeague,
  type DraftUISettings,
} from '@/lib/draft-defaults/DraftUISettingsResolver'
import {
  getLeagueScoringConfig,
  type LeagueScoringConfig,
} from '@/lib/scoring-defaults/LeagueScoringConfigResolver'
import {
  getWaiverConfigForLeague,
  type WaiverConfigForLeague,
} from '@/lib/waiver-defaults/WaiverConfigResolver'
import {
  getPlayoffConfigForLeague,
  type PlayoffConfigForLeague,
} from '@/lib/playoff-defaults/PlayoffConfigResolver'
import {
  getScheduleConfigForLeague,
  type ScheduleConfigForLeague,
} from '@/lib/schedule-defaults/ScheduleConfigResolver'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

type JsonRecord = Record<string, unknown>

type CanonicalLeagueSettingsRow = {
  draftDateUtc?: Date | string | null
  timezone?: string | null
  autostart?: boolean | null
  slowDraftPause?: boolean | null
  slowPauseFrom?: string | null
  slowPauseUntil?: string | null
  cpuAutoPick?: boolean | null
  aiAutoPick?: boolean | null
  draftType?: string | null
  pickTimerPreset?: string | null
  pickTimerCustomValue?: number | null
  rounds?: number | null
  draftOrderMethod?: string | null
  randomizeCount?: number | null
  draftOrderLocked?: boolean | null
  keeperCount?: number | null
  playerPool?: string | null
  aiQueueSuggestions?: boolean | null
  aiBestAvailable?: boolean | null
  aiRosterGuidance?: boolean | null
  aiScarcityAlerts?: boolean | null
  aiDraftGrade?: boolean | null
  aiSleeperAlerts?: boolean | null
  aiByeAwareness?: boolean | null
  aiStackSuggestions?: boolean | null
  aiRiskUpsideNotes?: boolean | null
  aiScope?: string | null
}

export type CanonicalLeagueRow = {
  id: string
  name?: string | null
  sport?: string | null
  season?: number | null
  leagueType?: string | null
  leagueVariant?: string | null
  scoringPresetId?: string | null
  scoring?: string | null
  leagueSize?: number | null
  rosterSize?: number | null
  starters?: unknown
  settings?: unknown
  settingsSnapshotVersion?: number | null
  presetKey?: string | null
  status?: string | null
  lifecycleState?: string | null
  locked?: boolean | null
  emergencyPaused?: boolean | null
  timezone?: string | null
  language?: string | null
  isDynasty?: boolean | null
  bestBallMode?: boolean | null
  guillotineMode?: boolean | null
  survivorMode?: boolean | null
  waiverType?: string | null
  waiverBudget?: number | null
  waiverMinBid?: number | null
  waiverClearAfterGames?: boolean | null
  waiverHours?: number | null
  customDailyWaivers?: boolean | null
  waiverProcessTime?: string | null
  waiverSchedule?: unknown
  tradeReviewHours?: number | null
  tradeDeadlineWeek?: number | null
  draftPickTrading?: boolean | null
  playoffStartWeek?: number | null
  playoffTeams?: number | null
  playoffWeeksPerRound?: number | null
  playoffSeedingRule?: string | null
  playoffLowerBracket?: string | null
  irSlots?: number | null
  irAllowCovid?: boolean | null
  irAllowOut?: boolean | null
  irAllowSuspended?: boolean | null
  irAllowNA?: boolean | null
  irAllowDNR?: boolean | null
  irAllowDoubtful?: boolean | null
  allowPreDraftMoves?: boolean | null
  preventBenchDrops?: boolean | null
  lockAllMoves?: boolean | null
  overrideInviteCapacity?: boolean | null
  disableInviteLinks?: boolean | null
  aiChimmyEnabled?: boolean | null
  aiWaiverSuggestions?: boolean | null
  aiTradeAnalysis?: boolean | null
  aiLineupHelp?: boolean | null
  aiDraftRecs?: boolean | null
  aiRecaps?: boolean | null
  leagueAiCommissionerAlerts?: boolean | null
  aiModeration?: boolean | null
  aiPowerRankings?: boolean | null
  autoCoachEnabled?: boolean | null
  leagueSettings?: CanonicalLeagueSettingsRow | null
}

export type CanonicalLeagueRules = {
  version: 1
  leagueId: string
  generatedAtIso: string
  source: {
    commissionerSettings: 'League'
    draftSettings: 'LeagueSettings'
    effectiveResolvers: Array<'draft' | 'draftUi' | 'scoring' | 'waivers' | 'playoffs' | 'schedule'>
    settingsSnapshotVersion: number | null
    presetKey: string | null
  }
  general: {
    name: string | null
    sport: string
    season: number | null
    format: string
    variant: string | null
    teamCount: number | null
    rosterSize: number | null
    lifecycleState: string | null
    status: string | null
    locked: boolean
    emergencyPaused: boolean
    timezone: string
    language: string
  }
  draft: {
    type: string
    rounds: number | null
    timerSeconds: number | null
    slowTimerSeconds: number | null
    timerMode: string | null
    scheduledAtIso: string | null
    orderMethod: string | null
    orderLocked: boolean
    pickOrderRules: string | null
    thirdRoundReversal: boolean
    autoPickEnabled: boolean
    cpuAutoPick: boolean
    commissionerForceAutoPickEnabled: boolean
    pickTradingEnabled: boolean
    importEnabled: boolean
    executionMode: string | null
    playerPool: string | null
    rosterFillOrder: string | null
    positionFilterBehavior: string | null
  }
  scoring: {
    templateId: string | null
    presetId: string | null
    formatType: string | null
    sport: string
    activeRuleCount: number
    overriddenRuleCount: number
    activeRules: Array<{
      statKey: string
      pointsValue: number
      category: string | null
      isOverridden: boolean
    }>
  }
  roster: {
    size: number | null
    starters: unknown
    irSlots: number
    eligibleReserveStatuses: string[]
    allowPreDraftMoves: boolean
    preventBenchDrops: boolean
    lockAllMoves: boolean
  }
  waivers: {
    type: string | null
    continuous: boolean
    processingDays: number[]
    processingTimeUtc: string | null
    processingTimeLocal: string | null
    claimLimitPerPeriod: number | null
    maxClaimsPerPeriod: number | null
    priorityBehavior: string | null
    gameLockBehavior: string | null
    dropLockBehavior: string | null
    freeAgentUnlockBehavior: string | null
    sameDayAddDropRules: string | null
    faabEnabled: boolean
    faabBudget: number | null
    faabMinBid: number | null
    faabResetRules: string | null
    tiebreakRule: string | null
    instantFreeAgencyAfterClear: boolean
  }
  trades: {
    reviewHours: number | null
    deadlineWeek: number | null
    draftPickTrading: boolean
  }
  playoffs: {
    teamCount: number | null
    startWeek: number | null
    startPoint: number | null
    weeksPerRound: number | null
    firstRoundByes: number
    bracketType: string | null
    matchupLength: number | null
    totalRounds: number | null
    consolationBracketEnabled: boolean
    thirdPlaceGameEnabled: boolean
    toiletBowlEnabled: boolean
    championshipLength: number | null
    consolationPlaysFor: string | null
    seedingRules: string | null
    tiebreakerRules: string[]
    byeRules: string | null
    reseedBehavior: string | null
    standingsTiebreakers: string[]
  }
  schedule: {
    unit: string | null
    regularSeasonLength: number | null
    matchupFrequency: string | null
    matchupCadence: string | null
    generationStrategy: string | null
    playoffTransitionPoint: number | null
    headToHeadBehavior: string | null
    lockTimeBehavior: string | null
    lockWindowBehavior: string | null
    scoringPeriodBehavior: string | null
    rescheduleHandling: string | null
    doubleheaderHandling: string | null
  }
  permissions: {
    settingsEditableByRoles: Array<'commissioner' | 'co_commissioner'>
    memberMovesLocked: boolean
    inviteLinksDisabled: boolean
    inviteCapacityOverride: boolean
  }
  intelligence: {
    chimmyHelperEnabled: boolean
    managerIntelligence: {
      requiredPlan: 'pro'
      requiredFeatures: SubscriptionFeatureId[]
      leagueToggles: SubscriptionFeatureId[]
    }
    commissionerIntelligence: {
      requiredPlan: 'commissioner'
      requiredFeatures: SubscriptionFeatureId[]
      enabledLeagueSettings: string[]
      lockedWithoutEntitlement: string[]
    }
    automation: {
      commissionerShortcutsEnabled: boolean
      weeklyLeagueReportEnabled: boolean
    }
  }
}

export type CanonicalLeagueRulesInput = {
  league: CanonicalLeagueRow
  draftConfig?: DraftRoomConfig | null
  draftUiSettings?: Partial<DraftUISettings> | null
  scoringConfig?: LeagueScoringConfig | null
  waiverConfig?: WaiverConfigForLeague | null
  playoffConfig?: PlayoffConfigForLeague | null
  scheduleConfig?: ScheduleConfigForLeague | null
  generatedAt?: Date
}

export type CanonicalRuntimeConsumerContext = Pick<
  CanonicalLeagueRules,
  'leagueId' | 'general' | 'draft' | 'scoring' | 'roster' | 'waivers' | 'trades' | 'playoffs' | 'schedule' | 'permissions'
>

const RESOLVER_NAMES = ['draft', 'draftUi', 'scoring', 'waivers', 'playoffs', 'schedule'] as const

const MANAGER_INTELLIGENCE_FEATURES: SubscriptionFeatureId[] = [
  'pro_draft_ai',
  'pro_waiver_ai',
  'pro_trade_ai',
  'pro_lineup_optimizer',
  'pro_autocoach',
]

const COMMISSIONER_INTELLIGENCE_FEATURES: SubscriptionFeatureId[] = [
  'commissioner_ai_tools',
  'commissioner_waiver_ai',
  'commissioner_integrity_monitoring',
  'commissioner_automation',
]

const COMMISSIONER_INTELLIGENCE_SETTINGS = [
  'aiWaiverSuggestions',
  'aiTradeAnalysis',
  'aiLineupHelp',
  'aiDraftRecs',
  'aiRecaps',
  'leagueAiCommissionerAlerts',
  'aiModeration',
  'aiPowerRankings',
] as const

const DRAFT_INTELLIGENCE_SETTINGS = [
  'aiQueueSuggestions',
  'aiBestAvailable',
  'aiRosterGuidance',
  'aiScarcityAlerts',
  'aiDraftGrade',
  'aiSleeperAlerts',
  'aiByeAwareness',
  'aiStackSuggestions',
  'aiRiskUpsideNotes',
  'aiScope',
] as const

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function recordOrEmpty(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function dateIsoOrNull(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}

function collectEnabledKeys<T extends readonly string[]>(source: JsonRecord, keys: T): string[] {
  return keys.filter((key) => source[key] === true)
}

function buildReserveStatuses(league: CanonicalLeagueRow): string[] {
  const statuses = new Set<string>()
  if (numberOrNull(league.irSlots) && Number(league.irSlots) > 0) {
    if (league.irAllowOut !== false) statuses.add('OUT')
    if (league.irAllowCovid) statuses.add('COVID')
    if (league.irAllowSuspended) statuses.add('SUSPENDED')
    if (league.irAllowNA) statuses.add('NA')
    if (league.irAllowDNR) statuses.add('DNR')
    if (league.irAllowDoubtful) statuses.add('DOUBTFUL')
  }
  return Array.from(statuses)
}

async function resolveOptional<T>(name: string, work: () => Promise<T | null>): Promise<T | null> {
  try {
    return await work()
  } catch (error) {
    console.warn(`[canonicalLeagueRules] ${name} resolver failed`, error)
    return null
  }
}

export function buildCanonicalLeagueRulesFromResolved({
  league,
  draftConfig = null,
  draftUiSettings = null,
  scoringConfig = null,
  waiverConfig = null,
  playoffConfig = null,
  scheduleConfig = null,
  generatedAt = new Date(),
}: CanonicalLeagueRulesInput): CanonicalLeagueRules {
  const settings = recordOrEmpty(league.settings)
  const draftSettings = league.leagueSettings ?? {}
  const enabledLeagueSettings = collectEnabledKeys(league as unknown as JsonRecord, COMMISSIONER_INTELLIGENCE_SETTINGS)
  const enabledDraftSettings = collectEnabledKeys(draftSettings as JsonRecord, DRAFT_INTELLIGENCE_SETTINGS)
  const draftDateIso = dateIsoOrNull(draftSettings.draftDateUtc)
  const fallbackDraftType = stringOrNull(draftSettings.draftType) ?? stringOrNull(settings.draft_type) ?? 'snake'
  const teamCount = numberOrNull(league.leagueSize)
  const rosterSize = numberOrNull(league.rosterSize)
  const sport = stringOrNull(league.sport) ?? draftConfig?.sport ?? scoringConfig?.sport ?? 'NFL'
  const format = stringOrNull(league.leagueType) ?? (league.isDynasty ? 'dynasty' : 'redraft')
  const activeRules = (scoringConfig?.rules ?? [])
    .filter((rule) => rule.enabled && Math.abs(Number(rule.pointsValue)) > 1e-9)
    .map((rule) => ({
      statKey: rule.statKey,
      pointsValue: Number(rule.pointsValue),
      category: stringOrNull((rule as unknown as { category?: unknown }).category),
      isOverridden: Boolean(rule.isOverridden),
    }))

  return {
    version: 1,
    leagueId: league.id,
    generatedAtIso: generatedAt.toISOString(),
    source: {
      commissionerSettings: 'League',
      draftSettings: 'LeagueSettings',
      effectiveResolvers: [...RESOLVER_NAMES],
      settingsSnapshotVersion: league.settingsSnapshotVersion ?? null,
      presetKey: league.presetKey ?? null,
    },
    general: {
      name: league.name ?? null,
      sport,
      season: numberOrNull(league.season),
      format,
      variant: stringOrNull(league.leagueVariant),
      teamCount,
      rosterSize,
      lifecycleState: stringOrNull(league.lifecycleState),
      status: stringOrNull(league.status),
      locked: booleanOr(league.locked, false),
      emergencyPaused: booleanOr(league.emergencyPaused, false),
      timezone: stringOrNull(league.timezone) ?? stringOrNull(draftSettings.timezone) ?? 'America/New_York',
      language: stringOrNull(league.language) ?? 'en',
    },
    draft: {
      type: draftConfig?.draft_type ?? fallbackDraftType,
      rounds: draftConfig?.rounds ?? numberOrNull(draftSettings.rounds),
      timerSeconds: draftConfig?.timer_seconds ?? numberOrNull(draftSettings.pickTimerCustomValue),
      slowTimerSeconds: draftConfig?.slow_timer_seconds ?? null,
      timerMode: stringOrNull(draftUiSettings?.timerMode),
      scheduledAtIso: draftDateIso,
      orderMethod: stringOrNull(draftSettings.draftOrderMethod),
      orderLocked: booleanOr(draftSettings.draftOrderLocked, false),
      pickOrderRules: draftConfig?.pick_order_rules ?? null,
      thirdRoundReversal: Boolean(draftConfig?.third_round_reversal),
      autoPickEnabled: booleanOr(draftUiSettings?.autoPickEnabled, Boolean(draftSettings.autostart)),
      cpuAutoPick: booleanOr(draftSettings.cpuAutoPick, true),
      commissionerForceAutoPickEnabled: booleanOr(draftUiSettings?.commissionerForceAutoPickEnabled, false),
      pickTradingEnabled: booleanOr(draftUiSettings?.pickTradeEnabled, booleanOr(league.draftPickTrading, false)),
      importEnabled: booleanOr(draftUiSettings?.importEnabled, true),
      executionMode: stringOrNull(draftUiSettings?.executionMode),
      playerPool: stringOrNull(draftSettings.playerPool),
      rosterFillOrder: draftConfig?.roster_fill_order ?? null,
      positionFilterBehavior: draftConfig?.position_filter_behavior ?? null,
    },
    scoring: {
      templateId: scoringConfig?.templateId ?? null,
      presetId: stringOrNull(league.scoringPresetId) ?? stringOrNull(league.scoring),
      formatType: scoringConfig?.formatType ?? null,
      sport: scoringConfig?.sport ?? sport,
      activeRuleCount: activeRules.length,
      overriddenRuleCount: activeRules.filter((rule) => rule.isOverridden).length,
      activeRules,
    },
    roster: {
      size: rosterSize,
      starters: league.starters ?? null,
      irSlots: numberOrNull(league.irSlots) ?? 0,
      eligibleReserveStatuses: buildReserveStatuses(league),
      allowPreDraftMoves: booleanOr(league.allowPreDraftMoves, true),
      preventBenchDrops: booleanOr(league.preventBenchDrops, false),
      lockAllMoves: booleanOr(league.lockAllMoves, false),
    },
    waivers: {
      type: waiverConfig?.waiver_type ?? stringOrNull(league.waiverType),
      continuous: Boolean(waiverConfig?.continuous_waivers),
      processingDays: waiverConfig?.processing_days ?? [],
      processingTimeUtc: waiverConfig?.processing_time_utc ?? null,
      processingTimeLocal: stringOrNull(league.waiverProcessTime),
      claimLimitPerPeriod: waiverConfig?.claim_limit_per_period ?? null,
      maxClaimsPerPeriod: waiverConfig?.max_claims_per_period ?? null,
      priorityBehavior: waiverConfig?.claim_priority_behavior ?? null,
      gameLockBehavior: waiverConfig?.game_lock_behavior ?? null,
      dropLockBehavior: waiverConfig?.drop_lock_behavior ?? null,
      freeAgentUnlockBehavior: waiverConfig?.free_agent_unlock_behavior ?? null,
      sameDayAddDropRules: waiverConfig?.same_day_add_drop_rules ?? null,
      faabEnabled: Boolean(waiverConfig?.faab_enabled),
      faabBudget: waiverConfig?.faab_budget ?? numberOrNull(league.waiverBudget),
      faabMinBid: numberOrNull(league.waiverMinBid),
      faabResetRules: waiverConfig?.faab_reset_rules ?? null,
      tiebreakRule: waiverConfig?.tiebreak_rule ?? null,
      instantFreeAgencyAfterClear: Boolean(waiverConfig?.instant_fa_after_clear),
    },
    trades: {
      reviewHours: numberOrNull(league.tradeReviewHours),
      deadlineWeek: numberOrNull(league.tradeDeadlineWeek),
      draftPickTrading: booleanOr(league.draftPickTrading, false),
    },
    playoffs: {
      teamCount: playoffConfig?.playoff_team_count ?? numberOrNull(league.playoffTeams),
      startWeek: playoffConfig?.playoff_start_week ?? numberOrNull(league.playoffStartWeek),
      startPoint: playoffConfig?.playoff_start_point ?? null,
      weeksPerRound: playoffConfig?.playoff_weeks ?? numberOrNull(league.playoffWeeksPerRound),
      firstRoundByes: playoffConfig?.first_round_byes ?? 0,
      bracketType: playoffConfig?.bracket_type ?? null,
      matchupLength: playoffConfig?.matchup_length ?? null,
      totalRounds: playoffConfig?.total_rounds ?? null,
      consolationBracketEnabled: Boolean(playoffConfig?.consolation_bracket_enabled),
      thirdPlaceGameEnabled: Boolean(playoffConfig?.third_place_game_enabled),
      toiletBowlEnabled: Boolean(playoffConfig?.toilet_bowl_enabled),
      championshipLength: playoffConfig?.championship_length ?? null,
      consolationPlaysFor: playoffConfig?.consolation_plays_for ?? stringOrNull(league.playoffLowerBracket),
      seedingRules: playoffConfig?.seeding_rules ?? stringOrNull(league.playoffSeedingRule),
      tiebreakerRules: playoffConfig?.tiebreaker_rules ?? [],
      byeRules: playoffConfig?.bye_rules ?? null,
      reseedBehavior: playoffConfig?.reseed_behavior ?? null,
      standingsTiebreakers: playoffConfig?.standings_tiebreakers ?? [],
    },
    schedule: {
      unit: scheduleConfig?.schedule_unit ?? null,
      regularSeasonLength: scheduleConfig?.regular_season_length ?? null,
      matchupFrequency: scheduleConfig?.matchup_frequency ?? null,
      matchupCadence: scheduleConfig?.matchup_cadence ?? null,
      generationStrategy: scheduleConfig?.schedule_generation_strategy ?? null,
      playoffTransitionPoint: scheduleConfig?.playoff_transition_point ?? null,
      headToHeadBehavior: scheduleConfig?.head_to_head_behavior ?? null,
      lockTimeBehavior: scheduleConfig?.lock_time_behavior ?? null,
      lockWindowBehavior: scheduleConfig?.lock_window_behavior ?? null,
      scoringPeriodBehavior: scheduleConfig?.scoring_period_behavior ?? null,
      rescheduleHandling: scheduleConfig?.reschedule_handling ?? null,
      doubleheaderHandling: scheduleConfig?.doubleheader_handling ?? null,
    },
    permissions: {
      settingsEditableByRoles: ['commissioner', 'co_commissioner'],
      memberMovesLocked: Boolean(league.locked || league.lockAllMoves || league.emergencyPaused),
      inviteLinksDisabled: booleanOr(league.disableInviteLinks, false),
      inviteCapacityOverride: booleanOr(league.overrideInviteCapacity, false),
    },
    intelligence: {
      chimmyHelperEnabled: booleanOr(league.aiChimmyEnabled, true),
      managerIntelligence: {
        requiredPlan: 'pro',
        requiredFeatures: MANAGER_INTELLIGENCE_FEATURES,
        leagueToggles: enabledDraftSettings.includes('aiRosterGuidance') ? ['pro_autocoach'] : [],
      },
      commissionerIntelligence: {
        requiredPlan: 'commissioner',
        requiredFeatures: COMMISSIONER_INTELLIGENCE_FEATURES,
        enabledLeagueSettings,
        lockedWithoutEntitlement: [...COMMISSIONER_INTELLIGENCE_SETTINGS, ...DRAFT_INTELLIGENCE_SETTINGS],
      },
      automation: {
        commissionerShortcutsEnabled: Boolean(league.leagueAiCommissionerAlerts || league.aiModeration),
        weeklyLeagueReportEnabled: Boolean(league.aiRecaps),
      },
    },
  }
}

export async function resolveCanonicalLeagueRules(leagueId: string): Promise<CanonicalLeagueRules | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { leagueSettings: true },
  })
  if (!league) return null

  const [draftConfig, draftUiSettings, scoringConfig, waiverConfig, playoffConfig, scheduleConfig] =
    await Promise.all([
      resolveOptional('draft', () => getDraftConfigForLeague(leagueId)),
      resolveOptional('draftUi', () => getDraftUISettingsForLeague(leagueId)),
      resolveOptional('scoring', () => getLeagueScoringConfig(leagueId)),
      resolveOptional('waivers', () => getWaiverConfigForLeague(leagueId)),
      resolveOptional('playoffs', () => getPlayoffConfigForLeague(leagueId)),
      resolveOptional('schedule', () => getScheduleConfigForLeague(leagueId)),
    ])

  return buildCanonicalLeagueRulesFromResolved({
    league: league as unknown as CanonicalLeagueRow,
    draftConfig,
    draftUiSettings,
    scoringConfig,
    waiverConfig,
    playoffConfig,
    scheduleConfig,
  })
}

export function buildCanonicalRuntimeConsumerContext(
  rules: CanonicalLeagueRules,
): CanonicalRuntimeConsumerContext {
  return {
    leagueId: rules.leagueId,
    general: rules.general,
    draft: rules.draft,
    scoring: rules.scoring,
    roster: rules.roster,
    waivers: rules.waivers,
    trades: rules.trades,
    playoffs: rules.playoffs,
    schedule: rules.schedule,
    permissions: rules.permissions,
  }
}
