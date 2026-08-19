import type {
  CommissionerPluginContract,
  DecisionOSPluginContract,
  DraftPluginContract,
  PlayoffPluginContract,
  SchedulePluginContract,
  ScoringPluginContract,
  TradePluginContract,
  WaiverPluginContract,
} from './pluginContracts'
import { LIFECYCLE_HOOK_NAMES } from './pluginLifecycle'

export const DRAFT_HOOK_NAMES = [
  'draftRules',
  'pickValidation',
  'timerBehavior',
  'rosterMaterialization',
  'draftCompletion',
] as const satisfies readonly (keyof DraftPluginContract)[]

export const SCHEDULE_HOOK_NAMES = [
  'scheduleGenerator',
  'matchupPolicy',
  'byePolicy',
  'divisions',
  'doubleHeaders',
  'rivalryRules',
] as const satisfies readonly (keyof SchedulePluginContract)[]

export const PLAYOFF_HOOK_NAMES = [
  'qualificationRules',
  'bracketGenerator',
  'reseedingPolicy',
  'consolationRules',
  'championPolicy',
] as const satisfies readonly (keyof PlayoffPluginContract)[]

export const WAIVER_HOOK_NAMES = [
  'waiverRules',
  'FAABRules',
  'priorityRules',
  'processingPolicy',
] as const satisfies readonly (keyof WaiverPluginContract)[]

export const TRADE_HOOK_NAMES = [
  'tradeRules',
  'assetValidation',
  'pickTradingRules',
  'deadlineRules',
] as const satisfies readonly (keyof TradePluginContract)[]

export const SCORING_HOOK_NAMES = [
  'scoringRules',
  'scoringCategories',
  'liveScoringHooks',
  'statCorrectionHooks',
] as const satisfies readonly (keyof ScoringPluginContract)[]

export const COMMISSIONER_HOOK_NAMES = [
  'commissionerSettings',
  'automationHooks',
  'AIHooks',
] as const satisfies readonly (keyof CommissionerPluginContract)[]

export const DECISION_OS_HOOK_NAMES = [
  'managerIntelligenceInputs',
  'leagueIntelligenceInputs',
  'platformIntelligenceInputs',
  'recommendationInputs',
] as const satisfies readonly (keyof DecisionOSPluginContract)[]

export const PLUGIN_HOOK_CATALOG = {
  lifecycle: LIFECYCLE_HOOK_NAMES,
  draft: DRAFT_HOOK_NAMES,
  schedule: SCHEDULE_HOOK_NAMES,
  playoffs: PLAYOFF_HOOK_NAMES,
  waivers: WAIVER_HOOK_NAMES,
  trades: TRADE_HOOK_NAMES,
  scoring: SCORING_HOOK_NAMES,
  commissioner: COMMISSIONER_HOOK_NAMES,
  decisionOS: DECISION_OS_HOOK_NAMES,
} as const
