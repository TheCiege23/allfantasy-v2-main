/**
 * Commissioner OS foundation — phase C0.5 (canonical league profile) and C5 (template runtime).
 *
 * ⚠ ADDITIVE. Nothing here replaces `resolveSpecialtyConceptKey`, `dispatchConceptHandler`,
 * `resolveLeagueRules`, `readFormatRules` or any specialty engine. The profile composes them and
 * carries the legacy concept key verbatim so the existing automation pipeline is untouched.
 *
 * See `docs/commissioner-os/PHASE_C0.5_C5_HANDOFF.md` for the audit, the decisions and what is
 * deliberately not built yet.
 */

export {
  composeCapabilities,
  capabilitiesForConcept,
  capabilitiesForFormat,
  hasCapabilityDomain,
  type CommissionerCapabilityId,
} from './capabilities'

export {
  resolveActionAuthority,
  describeActionAuthority,
  type ActionAuthority,
  type EffectScope,
  type ResolveActionAuthorityInput,
} from './authority'

export {
  RULE_EFFECTS,
  RULE_EFFECT_TYPES,
  getRuleEffect,
  type RuleEffectDefinition,
  type RuleEffectExecutorStatus,
  type RuleEffectType,
} from './ruleEffects'

export {
  COMMISSIONER_PROFILE_VERSION,
  type CommissionerFormatBasis,
  type CommissionerLeagueProfile,
  type CommissionerNetworkMembership,
  type CommissionerProfileDegradeReason,
  type CommissionerTemplateBinding,
} from './profile/types'

export {
  resolveCommissionerLeagueProfile,
  type CommissionerLeagueRow,
  type ResolveCommissionerLeagueProfileInput,
} from './profile/resolveCommissionerLeagueProfile'

export {
  readCommissionerTemplatePin,
  buildCommissionerTemplatePinFragment,
  type CommissionerTemplatePin,
} from './profile/templatePin'

export {
  templateKey,
  validateTemplateDefinition,
  type CommissionerAutomationPolicy,
  type ExternalPlatformBehavior,
  type LeagueTemplateDefinition,
  type LeagueTemplateId,
  type LeagueTemplateKey,
  type ScheduledRuleEffect,
  type TemplatePhase,
  type TemplatePhaseGraph,
  type TemplateValidationIssue,
} from './template/types'

export {
  listTemplateVersions,
  listVersionsOf,
  latestVersionOf,
  resolveTemplate,
  resolveTemplateByKey,
} from './template/registry'

export {
  planTemplateActions,
  type PlannedTemplateAction,
  type PlanTemplateActionsInput,
  type TemplatePlan,
} from './template/planTemplateActions'
