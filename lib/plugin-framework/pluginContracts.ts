import type {
  CorePluginId,
  PluginCapabilityMap,
  PluginContext,
  PluginHookHandler,
  PluginReadiness,
} from './pluginTypes'

export type MaybePromise<T> = T | Promise<T>

export type PluginRuleResolver<TResult = unknown, TContext extends PluginContext = PluginContext> = (
  context: TContext,
) => MaybePromise<TResult>

export type PluginValidator<TContext extends PluginContext = PluginContext> = (
  context: TContext,
) => MaybePromise<{ ok: true; metadata?: Record<string, unknown> } | { ok: false; code: string; message: string }>

export type PluginLifecycleHooks = {
  onLeagueCreated?: PluginHookHandler
  onLeagueActivated?: PluginHookHandler
  onDraftCreated?: PluginHookHandler
  onDraftCompleted?: PluginHookHandler
  onSeasonStarted?: PluginHookHandler
  onWeekAdvanced?: PluginHookHandler
  onPlayoffsStarted?: PluginHookHandler
  onChampionFinalized?: PluginHookHandler
  onLeagueArchived?: PluginHookHandler
  onSeasonRolledOver?: PluginHookHandler
}

export type DraftPluginContract = {
  draftRules?: PluginRuleResolver
  pickValidation?: PluginValidator
  timerBehavior?: PluginRuleResolver
  rosterMaterialization?: PluginHookHandler
  draftCompletion?: PluginHookHandler
}

export type SchedulePluginContract = {
  scheduleGenerator?: PluginRuleResolver
  matchupPolicy?: PluginRuleResolver
  byePolicy?: PluginRuleResolver
  divisions?: PluginRuleResolver
  doubleHeaders?: PluginRuleResolver
  rivalryRules?: PluginRuleResolver
}

export type PlayoffPluginContract = {
  qualificationRules?: PluginRuleResolver
  bracketGenerator?: PluginRuleResolver
  reseedingPolicy?: PluginRuleResolver
  consolationRules?: PluginRuleResolver
  championPolicy?: PluginHookHandler
}

export type WaiverPluginContract = {
  waiverRules?: PluginRuleResolver
  FAABRules?: PluginRuleResolver
  priorityRules?: PluginRuleResolver
  processingPolicy?: PluginRuleResolver
}

export type TradePluginContract = {
  tradeRules?: PluginRuleResolver
  assetValidation?: PluginValidator
  pickTradingRules?: PluginRuleResolver
  deadlineRules?: PluginRuleResolver
}

export type ScoringPluginContract = {
  scoringRules?: PluginRuleResolver
  scoringCategories?: PluginRuleResolver
  liveScoringHooks?: PluginHookHandler
  statCorrectionHooks?: PluginHookHandler
}

export type CommissionerPluginContract = {
  commissionerSettings?: PluginRuleResolver
  automationHooks?: PluginHookHandler
  AIHooks?: PluginHookHandler
}

export type DecisionOSPluginContract = {
  managerIntelligenceInputs?: PluginRuleResolver
  leagueIntelligenceInputs?: PluginRuleResolver
  platformIntelligenceInputs?: PluginRuleResolver
  recommendationInputs?: PluginRuleResolver
}

export type CoreLeaguePlugin = {
  id: CorePluginId
  label: string
  version: string
  readiness: PluginReadiness
  description: string
  extends?: CorePluginId[]
  capabilities: PluginCapabilityMap
  lifecycle?: PluginLifecycleHooks
  draft?: DraftPluginContract
  schedule?: SchedulePluginContract
  playoffs?: PlayoffPluginContract
  waivers?: WaiverPluginContract
  trades?: TradePluginContract
  scoring?: ScoringPluginContract
  commissioner?: CommissionerPluginContract
  decisionOS?: DecisionOSPluginContract
  metadata?: Record<string, unknown>
}

export function definePlugin(plugin: CoreLeaguePlugin): CoreLeaguePlugin {
  return plugin
}
