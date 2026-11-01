/**
 * League Creation Wizard — state and step types.
 * Supports all sports (NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER) and league/draft types.
 */

import type { LeagueSport } from '@prisma/client'
import type { DevyLeagueSetupState } from '@/lib/devy/devy-league-config'
import type { SoccerPipeline } from '@/lib/soccer/soccer-pipeline'

export type WizardStepId =
  | 'sport'
  | 'league_type'
  | 'draft_type'
  | 'team_setup'
  | 'scoring'
  | 'draft_settings'
  | 'waiver_settings'
  | 'playoff_settings'
  | 'schedule_settings'
  | 'ai_settings'
  | 'automation'
  | 'privacy'
  /** Combined draft + draft AI + automation + privacy (streamlined 5-step flow). */
  | 'draft_privacy'
  | 'review'

/** Where the user is drawing inspiration from at league setup. */
export type WizardSetupSource = 'fresh' | 'copy_league' | 'external_guide'

/** Mirror common host defaults for scoring/roster presets (AllFantasy = platform defaults). */
export type PlatformStyleMirror = 'af' | 'espn' | 'yahoo' | 'sleeper'

export type LeagueTypeId =
  | 'redraft'
  | 'dynasty'
  | 'keeper'
  | 'best_ball'
  | 'guillotine'
  | 'survivor'
  | 'tournament'
  | 'devy'
  | 'c2c'
  | 'zombie'
  | 'salary_cap'
  | 'big_brother'

export type DraftTypeId =
  | 'snake'
  | 'linear'
  | 'auction'
  | 'slow_draft'
  | 'mock_draft'
  | 'devy_snake'
  | 'devy_linear'
  | 'devy_auction'
  | 'c2c_snake'
  | 'c2c_linear'
  | 'c2c_auction'

export interface WizardDraftSettings {
  rounds: number
  timerSeconds: number | null
  thirdRoundReversal: boolean
  /** Auction only */
  auctionBudgetPerTeam: number | null
  /** Keeper only */
  keeperMaxKeepers: number | null
  /** Devy only */
  devyRounds: number[]
  devySlotCount?: number
  devyIrSlots?: number
  devyTaxiSlots?: number
  devyCollegeSports?: string[]
  /** C2C only */
  c2cCollegeRounds: number[]
  c2cCollegeSports?: string[]
  /** C2C: merged | separate */
  c2cStartupMode?: 'merged' | 'separate'
  /** C2C: unified | separate | hybrid */
  c2cStandingsModel?: 'unified' | 'separate' | 'hybrid'
  c2cBestBallPro?: boolean
  c2cBestBallCollege?: boolean
  c2cCollegeRosterSize?: number
  c2cRookieDraftRounds?: number
  c2cCollegeDraftRounds?: number
  c2cScoringSystem?: 'ppr' | 'standard' | 'points'
  c2cMixProPlayers?: boolean
}

export interface WizardAISettings {
  aiAdpEnabled: boolean
  orphanTeamAiManagerEnabled: boolean
  draftHelperEnabled: boolean
}

/**
 * Optional AF Commissioner AI tools (configured at creation; full controls stay in league settings).
 * Persisted on league settings when the user has AF Commissioner access.
 */
export interface WizardCommissionerPreferences {
  leagueAutomation: boolean
  integrityMonitoring: boolean
  weeklyRecaps: boolean
  draftCopilot: boolean
  matchupNarration: boolean
  fairnessAudit: boolean
  powerRankingsAi: boolean
  constitutionAssistant: boolean
}

export const DEFAULT_COMMISSIONER_PREFERENCES: WizardCommissionerPreferences = {
  leagueAutomation: false,
  integrityMonitoring: false,
  weeklyRecaps: false,
  draftCopilot: false,
  matchupNarration: false,
  fairnessAudit: false,
  powerRankingsAi: false,
  constitutionAssistant: false,
}

export interface WizardWaiverSettings {
  waiverType: 'faab' | 'rolling' | 'reverse_standings' | 'fcfs' | 'standard'
  processingDays: number[]
  processingTimeUtc: string | null
  faabEnabled: boolean
  faabBudget: number | null
  faabResetRules: string | null
  claimPriorityBehavior: string | null
  continuousWaiversBehavior: boolean
  freeAgentUnlockBehavior: string | null
  gameLockBehavior: string | null
  dropLockBehavior: string | null
  sameDayAddDropRules: string | null
  maxClaimsPerPeriod: number | null
}

export interface WizardPlayoffSettings {
  playoffTeamCount: number
  playoffWeeks: number
  playoffStartWeek: number | null
  seedingRules: string
  tiebreakerRules: string[]
  byeRules: string | null
  firstRoundByes: number
  matchupLength: number
  totalRounds: number | null
  consolationBracketEnabled: boolean
  thirdPlaceGameEnabled: boolean
  toiletBowlEnabled: boolean
  championshipLength: number
  consolationPlaysFor: 'pick' | 'none' | 'cash'
  reseedBehavior: string
}

export interface WizardScheduleSettings {
  scheduleUnit: 'week' | 'round' | 'series' | 'slate' | 'scoring_period'
  regularSeasonLength: number
  matchupFrequency: 'weekly' | 'daily' | 'round' | 'slate'
  matchupCadence: 'weekly' | 'daily' | 'round' | 'slate'
  headToHeadOrPointsBehavior: string
  lockTimeBehavior: 'game_time' | 'first_game' | 'slate_lock' | 'manual'
  lockWindowBehavior: string
  scoringPeriodBehavior: string
  rescheduleHandling: string
  doubleheaderOrMultiGameHandling: string
  playoffTransitionPoint: number | null
  scheduleGenerationStrategy: string
}

export interface WizardAutomationSettings {
  draftNotificationsEnabled: boolean
  autopickFromQueueEnabled: boolean
  slowDraftRemindersEnabled: boolean
  /** Dynasty leagues: how much AllFantasy runs (./selfRunningPreset.ts). Absent reads as recommended. */
  selfRunningPreset?: 'hands_on' | 'recommended' | 'run_it'
}

export interface WizardPrivacySettings {
  visibility: 'private' | 'unlisted' | 'public'
  allowInviteLink: boolean
}

/**
 * UI-only type contracts used by wizard format panels.
 * These are consolidated here so panel imports remain stable.
 */
export interface WizardSurvivorSettings {
  commissionerPlays: boolean
  tribeCount: number
  mergeAtCount: number
  idolsEnabled: boolean
  exileEnabled: boolean
  rocksEnabled: boolean
  idolCount: number
}

export interface WizardZombieSettings {
  whispererSelection: 'random' | 'veteran_priority'
  infectionLossToWhisperer: boolean
  infectionLossToZombie: boolean
  zombieTradeBlocked: boolean
  serumReviveCount: number
  ambushCountPerWeek: number
}

export interface WizardGuillotineSettings {
  endgame: 'last_team_standing' | 'final_four' | 'final_three' | 'final_two'
  eliminationsPerPeriod: number
  faabBudget: number
  protectedWeek1: boolean
  samePeriodPickups: boolean
  tradesEnabled: boolean
}

export interface WizardTournamentSettings {
  participantCount: number
  conferenceCount: number
  leaguesPerConference: number
  teamsPerLeague: number
  namingMode: 'ai_generated' | 'commissioner_custom' | 'hybrid'
  totalRounds: number
  advancersPerLeague: number
  bubbleEnabled: boolean
  redraftBetweenRounds: boolean
  tradesEnabled: boolean
}

export interface WizardSalaryCapSettings {
  draftMode: 'auction' | 'snake'
  salaryCurve: 'linear' | 'steep' | 'exponential' | 'flat'
  totalCap: number
  maxSalary: number
  minSalary: number
  defaultContractYears: number
  maxContractYears: number
  franchiseTagEnabled: boolean
  deadMoneyEnabled: boolean
  capRolloverEnabled: boolean
  capFloorEnabled: boolean
}

export interface WizardIdpSettings {
  positionMode: 'standard' | 'advanced' | 'hybrid'
  rosterPreset: 'beginner' | 'standard' | 'advanced' | 'custom'
  dlSlots: number
  lbSlots: number
  dbSlots: number
  idpFlexSlots: number
  scoringPreset: 'balanced' | 'tackle_heavy' | 'big_play_heavy'
}

export interface LeagueCreationWizardState {
  step: WizardStepId
  /** Starting point: build fresh, clone an AF league’s settings, or use the full import flow elsewhere. */
  setupSource: WizardSetupSource
  /** When `setupSource` is `copy_league`, the source league id (AllFantasy leagues only). */
  copyFromLeagueId: string | null
  /** IANA timezone for waivers, drafts, and league clock. */
  leagueTimezone: string
  /** Visual preset for scoring defaults (maps to variant / presets per sport). */
  platformStyleMirror: PlatformStyleMirror
  sport: LeagueSport | string
  /** When sport is SOCCER: MLS vs European data feeds (stored as `settings.soccer_pipeline`). */
  soccerPipeline: SoccerPipeline | null
  leagueType: LeagueTypeId
  draftType: DraftTypeId
  name: string
  teamCount: number
  rosterSize: number | null
  scoringPreset: string | null
  leagueVariant: string | null
  draftSettings: WizardDraftSettings
  waiverSettings: WizardWaiverSettings
  playoffSettings: WizardPlayoffSettings
  scheduleSettings: WizardScheduleSettings
  tradeReviewMode: 'none' | 'commissioner' | 'league_vote' | 'instant'
  aiSettings: WizardAISettings
  automationSettings: WizardAutomationSettings
  /** AF Commissioner-tier AI (gated in UI unless subscribed). */
  commissionerPreferences: WizardCommissionerPreferences
  privacySettings: WizardPrivacySettings
  /** Per–league-type fields (tournament hub, survivor tribes, keeper count, etc.). */
  formatOptions: import('@/lib/league-creation-wizard/wizard-format-options').WizardFormatOptions
  /**
   * Optional full settings snapshot from a saved template.
   * These keys are merged into League.settings on create before wizard-level overrides.
   */
  templateSettingsOverrides?: Record<string, unknown>
  /** Populated when `leagueType === 'devy'` — persisted as `League.settings.devy_league_config`. */
  devyLeagueSetup: DevyLeagueSetupState
}

/** Five-step flow: setup → identity → scoring → draft/privacy/AI → review. */
export const WIZARD_STEP_ORDER = [
  'sport',
  'team_setup',
  'scoring',
  'draft_privacy',
  'review',
] as const satisfies readonly WizardStepId[]

/** Steps actually shown in the current wizard flow (subset of {@link WizardStepId}). */
export type WizardActiveStepId = (typeof WIZARD_STEP_ORDER)[number]

export const DEFAULT_DRAFT_SETTINGS: WizardDraftSettings = {
  rounds: 15,
  timerSeconds: 90,
  thirdRoundReversal: false,
  auctionBudgetPerTeam: 200,
  keeperMaxKeepers: 3,
  devyRounds: [],
  devySlotCount: 12,
  devyIrSlots: 2,
  devyTaxiSlots: 6,
  devyCollegeSports: ['NCAAF'],
  c2cCollegeRounds: [],
  c2cCollegeSports: ['NCAAF'],
  c2cStartupMode: 'merged',
  c2cStandingsModel: 'unified',
  c2cBestBallPro: true,
  c2cBestBallCollege: false,
  c2cCollegeRosterSize: 20,
  c2cRookieDraftRounds: 4,
  c2cCollegeDraftRounds: 6,
  c2cScoringSystem: 'ppr',
  c2cMixProPlayers: true,
}

export const DEFAULT_AI_SETTINGS: WizardAISettings = {
  aiAdpEnabled: false,
  orphanTeamAiManagerEnabled: false,
  draftHelperEnabled: true,
}

export const DEFAULT_WAIVER_SETTINGS: WizardWaiverSettings = {
  waiverType: 'faab',
  processingDays: [2],
  processingTimeUtc: '10:00',
  faabEnabled: true,
  faabBudget: 100,
  faabResetRules: 'never',
  claimPriorityBehavior: 'faab_highest',
  continuousWaiversBehavior: false,
  freeAgentUnlockBehavior: 'after_waiver_run',
  gameLockBehavior: 'game_time',
  dropLockBehavior: 'lock_with_game',
  sameDayAddDropRules: 'allow_if_not_played',
  maxClaimsPerPeriod: 10,
}

export const DEFAULT_PLAYOFF_SETTINGS: WizardPlayoffSettings = {
  playoffTeamCount: 6,
  playoffWeeks: 3,
  playoffStartWeek: 15,
  seedingRules: 'standard_standings',
  tiebreakerRules: ['points_for', 'head_to_head', 'points_against'],
  byeRules: 'top_two_seeds_bye',
  firstRoundByes: 2,
  matchupLength: 1,
  totalRounds: 3,
  consolationBracketEnabled: true,
  thirdPlaceGameEnabled: true,
  toiletBowlEnabled: false,
  championshipLength: 1,
  consolationPlaysFor: 'pick',
  reseedBehavior: 'fixed_bracket',
}

export const DEFAULT_SCHEDULE_SETTINGS: WizardScheduleSettings = {
  scheduleUnit: 'week',
  regularSeasonLength: 18,
  matchupFrequency: 'weekly',
  matchupCadence: 'weekly',
  headToHeadOrPointsBehavior: 'head_to_head',
  lockTimeBehavior: 'first_game',
  lockWindowBehavior: 'first_game_of_week',
  scoringPeriodBehavior: 'full_period',
  rescheduleHandling: 'use_final_time',
  doubleheaderOrMultiGameHandling: 'all_games_count',
  playoffTransitionPoint: 15,
  scheduleGenerationStrategy: 'round_robin',
}

export const DEFAULT_AUTOMATION_SETTINGS: WizardAutomationSettings = {
  draftNotificationsEnabled: true,
  autopickFromQueueEnabled: true,
  slowDraftRemindersEnabled: true,
  selfRunningPreset: 'recommended',
}

export const DEFAULT_PRIVACY_SETTINGS: WizardPrivacySettings = {
  visibility: 'private',
  allowInviteLink: true,
}
