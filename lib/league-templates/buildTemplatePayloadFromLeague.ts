/**
 * Build LeagueTemplatePayload from an existing League (for "Save as template" from league settings).
 */

import type { LeagueTemplatePayload } from './types'
import {
  DEFAULT_DRAFT_SETTINGS,
  DEFAULT_WAIVER_SETTINGS,
  DEFAULT_PLAYOFF_SETTINGS,
  DEFAULT_SCHEDULE_SETTINGS,
  DEFAULT_AI_SETTINGS,
  DEFAULT_AUTOMATION_SETTINGS,
  DEFAULT_PRIVACY_SETTINGS,
} from '@/lib/league-creation-wizard/types'
import { AF_OWNED_LEAGUE_SETTINGS_KEYS } from '@/lib/league/afOwnedLeagueSettings'

interface LeagueRow {
  id: string
  name: string | null
  sport: string
  leagueSize: number | null
  leagueVariant: string | null
  scoring: string | null
  isDynasty: boolean
  rosterSize: number | null
  settings: unknown
}

/**
 * Keys that belong to ONE league and must never ride into a template. It started as seven keys, so a
 * template carried the source league's dues ledger, manager ratings, orphan requests, lottery result,
 * change log and more. Every AllFantasy-owned key (lib/league/afOwnedLeagueSettings.ts) is league state
 * EXCEPT the few that are genuinely rules, listed in TEMPLATE_RULE_KEYS; the rest are season and import
 * bookkeeping.
 */
const TEMPLATE_RULE_KEYS = new Set<string>([
  'draft_order_mode',
  'draft_lottery_config',
  'concept_rules_overlay',
  'devy_league_config',
  'c2cTaxiLockMode',
  'rookie_devy_lock',
])

export const TEMPLATE_SETTINGS_BLACKLIST = new Set<string>([
  ...AF_OWNED_LEAGUE_SETTINGS_KEYS.filter((k) => !TEMPLATE_RULE_KEYS.has(k)),
  'league_password_hash',
  'source_tracking',
  'identity_mappings',
  'league_import_last_summary',
  'metadata',
  // Season state written by renew / rollover.
  'renewal_completed_for_season',
  'dynastySeasonPhase',
  'season_phase',
  'dispersal_draft_eligible',
  'orphan_count_at_renewal',
  // This league's own schedule and media.
  'draftDate',
  'draftTime',
  'draftDateUtc',
  'introVideoUrl',
  'introPosterUrl',
  // Commissioner tools' per-league state.
  'draft_day_show',
  'commissioner_reputation_public',
  'constitution_amendments',
  'weekly_recap_review',
])

function sanitizeTemplateSettingsOverrides(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (TEMPLATE_SETTINGS_BLACKLIST.has(key)) continue
    next[key] = value
  }
  return next
}

function readString(settings: Record<string, unknown>, keys: string[], fallback: string | null = null): string | null {
  for (const key of keys) {
    const value = settings[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return fallback
}

function readBoolean(settings: Record<string, unknown>, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const value = settings[key]
    if (typeof value === 'boolean') return value
  }
  return fallback
}

function readNumber(settings: Record<string, unknown>, keys: string[], fallback: number | null = null): number | null {
  for (const key of keys) {
    const value = settings[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return fallback
}

function readNumberArray(settings: Record<string, unknown>, keys: string[], fallback: number[] = []): number[] {
  for (const key of keys) {
    const value = settings[key]
    if (Array.isArray(value)) {
      return value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item))
        .map((item) => Math.round(item))
    }
  }
  return fallback
}

export function buildTemplatePayloadFromLeague(league: LeagueRow): LeagueTemplatePayload {
  const s = (league.settings ?? {}) as Record<string, unknown>
  const templateSettingsOverrides = sanitizeTemplateSettingsOverrides(s)
  const playoffStructure =
    s.playoff_structure && typeof s.playoff_structure === 'object'
      ? (s.playoff_structure as Record<string, unknown>)
      : {}
  const leagueType =
    readString(s, ['league_type', 'leagueType'], league.isDynasty ? 'dynasty' : 'redraft') ??
    (league.isDynasty ? 'dynasty' : 'redraft')
  const draftType = readString(s, ['draft_type', 'draftType'], 'snake') ?? 'snake'
  const visibilityRaw =
    readString(
      s,
      ['visibility', 'league_privacy_visibility'],
      DEFAULT_PRIVACY_SETTINGS.visibility
    ) ?? DEFAULT_PRIVACY_SETTINGS.visibility
  const visibility = visibilityRaw === 'public' || visibilityRaw === 'unlisted'
    ? visibilityRaw
    : DEFAULT_PRIVACY_SETTINGS.visibility
  const orphanMode = readString(
    s,
    ['draft_orphan_drafter_mode'],
    'cpu'
  )
  const orphanManagerEnabledFromSettings = readBoolean(
    s,
    ['draft_orphan_team_ai_manager_enabled', 'orphan_team_ai_manager_enabled'],
    false
  )
  const orphanTeamAiManagerEnabled =
    orphanManagerEnabledFromSettings && (orphanMode === 'ai' || orphanMode === 'cpu')

  return {
    sport: league.sport ?? 'NFL',
    leagueType: leagueType as LeagueTemplatePayload['leagueType'],
    draftType: draftType as LeagueTemplatePayload['draftType'],
    name: league.name?.trim() || 'My League',
    teamCount: league.leagueSize ?? 12,
    rosterSize: league.rosterSize ?? null,
    scoringPreset: league.leagueVariant ?? league.scoring ?? null,
    leagueVariant: league.leagueVariant ?? null,
    draftSettings: {
      rounds: readNumber(s, ['draft_rounds'], DEFAULT_DRAFT_SETTINGS.rounds) ?? DEFAULT_DRAFT_SETTINGS.rounds,
      timerSeconds: readNumber(s, ['draft_timer_seconds'], DEFAULT_DRAFT_SETTINGS.timerSeconds),
      thirdRoundReversal: readBoolean(
        s,
        ['draft_third_round_reversal', 'third_round_reversal'],
        DEFAULT_DRAFT_SETTINGS.thirdRoundReversal
      ),
      auctionBudgetPerTeam: readNumber(
        s,
        ['auction_budget_per_team', 'auctionBudgetPerTeam'],
        DEFAULT_DRAFT_SETTINGS.auctionBudgetPerTeam
      ),
      keeperMaxKeepers: readNumber(s, ['keeper_max_keepers'], DEFAULT_DRAFT_SETTINGS.keeperMaxKeepers),
      devyRounds: readNumberArray(s, ['devy_rounds'], DEFAULT_DRAFT_SETTINGS.devyRounds),
      c2cCollegeRounds: readNumberArray(
        s,
        ['c2c_college_rounds'],
        DEFAULT_DRAFT_SETTINGS.c2cCollegeRounds
      ),
    },
    waiverSettings: {
      waiverType: (readString(s, ['waiver_type'], DEFAULT_WAIVER_SETTINGS.waiverType) as 'faab' | 'rolling' | 'reverse_standings' | 'fcfs' | 'standard') ?? DEFAULT_WAIVER_SETTINGS.waiverType,
      processingDays: Array.isArray(s.waiver_processing_days) ? (s.waiver_processing_days as number[]) : DEFAULT_WAIVER_SETTINGS.processingDays,
      processingTimeUtc: readString(s, ['waiver_processing_time_utc'], DEFAULT_WAIVER_SETTINGS.processingTimeUtc),
      faabEnabled: readBoolean(s, ['faab_enabled'], DEFAULT_WAIVER_SETTINGS.faabEnabled),
      faabBudget: readNumber(s, ['faab_budget'], DEFAULT_WAIVER_SETTINGS.faabBudget),
      faabResetRules: readString(s, ['faab_reset_rules'], DEFAULT_WAIVER_SETTINGS.faabResetRules),
      claimPriorityBehavior: readString(
        s,
        ['waiver_claim_priority_behavior'],
        DEFAULT_WAIVER_SETTINGS.claimPriorityBehavior
      ),
      continuousWaiversBehavior: readBoolean(
        s,
        ['waiver_continuous_waivers_behavior'],
        DEFAULT_WAIVER_SETTINGS.continuousWaiversBehavior
      ),
      freeAgentUnlockBehavior: readString(
        s,
        ['waiver_free_agent_unlock_behavior'],
        DEFAULT_WAIVER_SETTINGS.freeAgentUnlockBehavior
      ),
      gameLockBehavior: readString(
        s,
        ['waiver_game_lock_behavior'],
        DEFAULT_WAIVER_SETTINGS.gameLockBehavior
      ),
      dropLockBehavior: readString(
        s,
        ['waiver_drop_lock_behavior'],
        DEFAULT_WAIVER_SETTINGS.dropLockBehavior
      ),
      sameDayAddDropRules: readString(
        s,
        ['waiver_same_day_add_drop_rules'],
        DEFAULT_WAIVER_SETTINGS.sameDayAddDropRules
      ),
      maxClaimsPerPeriod: readNumber(
        s,
        ['waiver_max_claims_per_period'],
        DEFAULT_WAIVER_SETTINGS.maxClaimsPerPeriod
      ),
    },
    playoffSettings: {
      playoffTeamCount: (s.playoff_team_count as number) ?? (playoffStructure.playoff_team_count as number) ?? DEFAULT_PLAYOFF_SETTINGS.playoffTeamCount,
      playoffWeeks: (playoffStructure.playoff_weeks as number) ?? DEFAULT_PLAYOFF_SETTINGS.playoffWeeks,
      playoffStartWeek: (playoffStructure.playoff_start_week as number | null) ?? DEFAULT_PLAYOFF_SETTINGS.playoffStartWeek,
      seedingRules: (playoffStructure.seeding_rules as string) ?? DEFAULT_PLAYOFF_SETTINGS.seedingRules,
      tiebreakerRules: Array.isArray(playoffStructure.tiebreaker_rules)
        ? (playoffStructure.tiebreaker_rules as string[])
        : DEFAULT_PLAYOFF_SETTINGS.tiebreakerRules,
      byeRules: (playoffStructure.bye_rules as string | null) ?? DEFAULT_PLAYOFF_SETTINGS.byeRules,
      firstRoundByes: (playoffStructure.first_round_byes as number) ?? DEFAULT_PLAYOFF_SETTINGS.firstRoundByes,
      matchupLength: (playoffStructure.matchup_length as number) ?? DEFAULT_PLAYOFF_SETTINGS.matchupLength,
      totalRounds: (playoffStructure.total_rounds as number | null) ?? DEFAULT_PLAYOFF_SETTINGS.totalRounds,
      consolationBracketEnabled:
        (playoffStructure.consolation_bracket_enabled as boolean) ?? DEFAULT_PLAYOFF_SETTINGS.consolationBracketEnabled,
      thirdPlaceGameEnabled:
        (playoffStructure.third_place_game_enabled as boolean) ?? DEFAULT_PLAYOFF_SETTINGS.thirdPlaceGameEnabled,
      toiletBowlEnabled:
        (playoffStructure.toilet_bowl_enabled as boolean) ?? DEFAULT_PLAYOFF_SETTINGS.toiletBowlEnabled,
      championshipLength:
        (playoffStructure.championship_length as number) ?? DEFAULT_PLAYOFF_SETTINGS.championshipLength,
      consolationPlaysFor:
        (playoffStructure.consolation_plays_for as 'pick' | 'none' | 'cash') ?? DEFAULT_PLAYOFF_SETTINGS.consolationPlaysFor,
      reseedBehavior:
        (playoffStructure.reseed_behavior as string) ?? DEFAULT_PLAYOFF_SETTINGS.reseedBehavior,
    },
    scheduleSettings: {
      scheduleUnit:
        (s.schedule_unit as 'week' | 'round' | 'series' | 'slate' | 'scoring_period') ??
        DEFAULT_SCHEDULE_SETTINGS.scheduleUnit,
      regularSeasonLength:
        (s.regular_season_length as number) ?? DEFAULT_SCHEDULE_SETTINGS.regularSeasonLength,
      matchupFrequency:
        (s.matchup_frequency as 'weekly' | 'daily' | 'round' | 'slate') ??
        DEFAULT_SCHEDULE_SETTINGS.matchupFrequency,
      matchupCadence:
        (s.schedule_cadence as 'weekly' | 'daily' | 'round' | 'slate') ??
        DEFAULT_SCHEDULE_SETTINGS.matchupCadence,
      headToHeadOrPointsBehavior:
        (s.schedule_head_to_head_behavior as string) ??
        DEFAULT_SCHEDULE_SETTINGS.headToHeadOrPointsBehavior,
      lockTimeBehavior:
        (s.lock_time_behavior as 'game_time' | 'first_game' | 'slate_lock' | 'manual') ??
        DEFAULT_SCHEDULE_SETTINGS.lockTimeBehavior,
      lockWindowBehavior:
        (s.schedule_lock_window_behavior as string) ?? DEFAULT_SCHEDULE_SETTINGS.lockWindowBehavior,
      scoringPeriodBehavior:
        (s.schedule_scoring_period_behavior as string) ??
        DEFAULT_SCHEDULE_SETTINGS.scoringPeriodBehavior,
      rescheduleHandling:
        (s.schedule_reschedule_handling as string) ?? DEFAULT_SCHEDULE_SETTINGS.rescheduleHandling,
      doubleheaderOrMultiGameHandling:
        (s.schedule_doubleheader_handling as string) ??
        DEFAULT_SCHEDULE_SETTINGS.doubleheaderOrMultiGameHandling,
      playoffTransitionPoint:
        (s.schedule_playoff_transition_point as number | null) ??
        DEFAULT_SCHEDULE_SETTINGS.playoffTransitionPoint,
      scheduleGenerationStrategy:
        (s.schedule_generation_strategy as string) ??
        DEFAULT_SCHEDULE_SETTINGS.scheduleGenerationStrategy,
    },
    aiSettings: {
      aiAdpEnabled: readBoolean(
        s,
        ['draft_ai_adp_enabled', 'ai_adp_enabled'],
        DEFAULT_AI_SETTINGS.aiAdpEnabled
      ),
      orphanTeamAiManagerEnabled: orphanTeamAiManagerEnabled || DEFAULT_AI_SETTINGS.orphanTeamAiManagerEnabled,
      draftHelperEnabled: readBoolean(
        s,
        ['draft_helper_enabled', 'ai_feature_draft_assistant_enabled'],
        DEFAULT_AI_SETTINGS.draftHelperEnabled
      ),
    },
    automationSettings: {
      draftNotificationsEnabled: readBoolean(
        s,
        ['draft_notifications_enabled'],
        DEFAULT_AUTOMATION_SETTINGS.draftNotificationsEnabled
      ),
      autopickFromQueueEnabled: readBoolean(
        s,
        ['autopick_from_queue_enabled', 'draft_auto_pick_enabled'],
        DEFAULT_AUTOMATION_SETTINGS.autopickFromQueueEnabled
      ),
      slowDraftRemindersEnabled: readBoolean(
        s,
        ['slow_draft_reminders_enabled'],
        DEFAULT_AUTOMATION_SETTINGS.slowDraftRemindersEnabled
      ),
    },
    privacySettings: {
      visibility,
      allowInviteLink: readBoolean(
        s,
        ['allow_invite_link', 'league_allow_invite_link'],
        DEFAULT_PRIVACY_SETTINGS.allowInviteLink
      ),
    },
    templateSettingsOverrides,
  }
}
