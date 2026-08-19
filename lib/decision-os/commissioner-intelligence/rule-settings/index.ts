/**
 * Commissioner Intelligence Platform — Phase 6: Rule / Settings.
 * Display-only, deterministic, DESCRIPTIVE configuration intelligence.
 * Explains league config; never judges the rules or recommends changes.
 */
export {
  COMMISSIONER_RULE_SETTINGS_VERSION,
  type CommissionerRuleSettingsV1,
  type LeagueFormat,
  type Complexity,
  type TransactionPolicy,
  type PlayoffConfiguration,
  type RuleSettingsSource,
  type RuleSettingsInput,
  type RuleSettingsDefaults,
} from './types'
export { aggregateCommissionerRuleSettings } from './ruleSettingsAggregator'
export {
  createLiveRuleSettingsDataProvider,
  type RuleSettingsDataProvider,
  type RuleSettingsResolverArgs,
} from './ruleSettingsResolver'
