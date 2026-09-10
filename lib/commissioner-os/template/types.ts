/**
 * The Commissioner OS template contract — a versioned, additive DESCRIPTION of a league concept.
 *
 * 🛑 A TEMPLATE COMPOSES ENGINES. IT DOES NOT CONTAIN THEM, AND IT NEVER REPLACES ONE. Every
 * policy block below points at the module that owns the behaviour (`canonicalEngine`) instead of
 * restating it. Guillotine elimination is `lib/guillotine/GuillotineEliminationEngine`, promotion
 * is `lib/promotion-relegation/PromotionEngine`, Survivor phases are `lib/survivor/gameStateMachine`
 * — all unchanged, all still canonical. A template that re-implemented any of them would be a
 * second copy of a rule, which this repo has already paid for elsewhere.
 *
 * ⚠ NOT THE SAME THING AS `lib/league-templates/`. That module is a CREATION-WIZARD PREFILL —
 * `LeagueTemplatePayload` captures an existing league's settings so the wizard can clone it. It has
 * no phases, no capabilities, no versioning and no runtime. The name collision is real and worth
 * knowing about; the two are not alternatives and neither subsumes the other. This one lives under
 * `lib/commissioner-os/` precisely so the distinction is visible in the import path.
 *
 * ## Versioning
 *
 * 🛑 A LEAGUE PINS `id@version` AND THE REGISTRY RESOLVES THAT EXACT PAIR OR NOTHING. There is no
 * "latest" fallback anywhere in this module, deliberately: a template edit that silently reached
 * every existing league would change the rules of a running season, and it would do it with no
 * conflict, no error and no migration — the failure shape this repo keeps paying for. A pin that
 * cannot be resolved degrades honestly (`templatePinUnresolved`) rather than resolving to something
 * near it.
 *
 * ⚠ SO A RULE CHANGE MEANS A NEW VERSION ENTRY, NOT AN EDIT. Editing a published version in place
 * mutates every league pinned to it. The registry keeps every version it has ever published; the
 * cost is a few kilobytes of frozen objects and the benefit is that an old league keeps playing the
 * game it started.
 *
 * Pure: frozen data and validators. No DB, no I/O, no clock, no AI.
 */

import type { LeagueSport } from '@prisma/client'
import type { LeagueFormatId } from '@/lib/league/format-engine'
import type { CommissionerCapabilityId } from '@/lib/commissioner-os/capabilities'
import type { RuleEffectExecutorStatus, RuleEffectType } from '@/lib/commissioner-os/ruleEffects'

/** Template ids. Additive — never rename one, a league may be pinned to it. */
export type LeagueTemplateId = 'efl_promotion_relegation_dynasty' | 'survivor_all_stars_guillotine'

/** `id@version`, the only thing a league stores and the only thing the registry accepts. */
export type LeagueTemplateKey = string

/**
 * Chimmy's automation posture for a template's actions.
 *
 * ⚠ DECLARED HERE AS A DEFAULT ONLY. The full policy system (per-action overrides, per-commissioner
 * settings, escalation) is explicitly NOT built in this phase. This field exists so a template can
 * state its intended posture and so the contract has the seam — nothing reads it to decide
 * behaviour yet, and `ask_first` is the default because a template with no considered posture must
 * not act on its own.
 */
export type CommissionerAutomationPolicy =
  | 'auto_execute'
  | 'execute_and_notify'
  | 'ask_first'
  | 'guide_only'
  | 'never'

/**
 * A phase in the template's state machine.
 *
 * ⚠ `next` IS A LIST, NOT A POINTER. Survivor All-Stars branches (the Gauntlet reaches the merge
 * only after three elimination weeks), and a linear `nextPhaseId` would have forced the branch into
 * imperative code — which is where a phase machine stops being inspectable.
 */
export type TemplatePhase = {
  id: string
  label: string
  summary: string
  /** Inclusive scoring-period range, when the phase is week-driven. */
  fromWeek?: number
  toWeek?: number
  /** Capabilities that only apply while in this phase (e.g. idols before week 10). */
  capabilityIds?: readonly CommissionerCapabilityId[]
  /** Phase ids reachable from here. Empty on a terminal phase. */
  next: readonly string[]
  terminal?: boolean
}

export type TemplatePhaseGraph = {
  initialPhaseId: string
  phases: readonly TemplatePhase[]
}

/** When a scheduled effect fires. Deterministic — no dates, no clock, no "soon". */
export type ScheduledEffectTrigger =
  | { kind: 'week'; week: number }
  | { kind: 'phase_entry'; phaseId: string }
  | { kind: 'phase_exit'; phaseId: string }
  | { kind: 'season_end' }

export type ScheduledRuleEffect = {
  /**
   * Stable within the template and part of the idempotency key.
   *
   * 🛑 NEVER REUSE OR RENUMBER AN ID INSIDE A PUBLISHED VERSION. The planner derives idempotency
   * from it, so changing an id re-fires an effect that already ran — which for `ELIMINATE_ROSTER`
   * means eliminating a second team.
   */
  id: string
  effect: RuleEffectType
  at: ScheduledEffectTrigger
  /** Effect-specific parameters. Opaque to the planner; read by whichever executor exists. */
  params?: Readonly<Record<string, unknown>>
  /**
   * What actually backs this effect FOR THIS TEMPLATE, overriding the global `executorStatus`.
   *
   * 🛑 IT OVERRIDES IN BOTH DIRECTIONS, AND MUST NAME A MODULE EITHER WAY.
   *
   * WIDENING: `ASSIGN_DRAFT_SLOT` has no generic executor — no engine anywhere computes an
   * arbitrary league's draft slots — but EFL's order IS computed, by
   * `lib/commissioner-os/efl/rookieDraftOrder.ts`. Without this the template could only say
   * "guidance only" about something it can produce exactly.
   *
   * NARROWING, AND THIS IS THE HALF THAT MATTERS MORE: `PROMOTE_TEAM` is globally `engine`, because
   * `PromotionEngine` genuinely applies standings-zone movement. EFL's movement is playoff-decided
   * and nothing applies it, so the EFL template must say `planned` and NOT inherit an execution
   * claim that is true of a different competition. A global vocabulary cannot know that; the
   * template does.
   *
   * ⚠ `engine` HERE IS A CLAIM THAT SOMETHING RUNS. Naming the module is what makes it checkable
   * rather than aspirational.
   */
  backedBy?: {
    engine: string
    status: RuleEffectExecutorStatus
    note?: string
  }
  description: string
}

/**
 * Policy blocks.
 *
 * ⚠ EACH ONE IS METADATA PLUS A POINTER, NOT AN IMPLEMENTATION. `canonicalEngine` names the module
 * that decides; `configurable` lists what a commissioner may change. Nothing in a policy block is
 * executed by this module.
 */
type PolicyBase = {
  canonicalEngine: string | null
  /** Commissioner-configurable knobs. Labels for the Hub; not a schema. */
  configurable?: readonly string[]
  notes?: readonly string[]
}

export type EliminationPolicy = PolicyBase & {
  mode: 'lowest_score' | 'vote' | 'bracket' | 'none'
  /** Teams removed per scoring period, by phase id. */
  perPeriodByPhase?: Readonly<Record<string, number>>
  /** Whether immunity passes elimination down to the next eligible team. */
  immunityPassesDown: boolean
}

export type RewardPolicy = PolicyBase & {
  seasonFaabBudget?: number
  rewardFaabEnabled: boolean
}

export type PowerPolicy = PolicyBase & {
  powers: readonly {
    id: string
    label: string
    /** Last scoring period the power may be used. Null when it does not expire. */
    expiresAfterWeek: number | null
    summary: string
  }[]
}

export type DraftPolicy = PolicyBase & {
  /** How the order is produced. `custom` means the template's own rule, described in notes. */
  rookieOrder: 'reverse_standings' | 'custom' | 'schoolyard' | 'not_applicable'
  /** An input that stops moving at a point in the season. */
  frozenInput?: { field: string; frozenAt: string }
}

export type StandingsPolicy = PolicyBase & {
  tiers?: readonly { level: number; label: string }[]
  promotionRelegation?: {
    autoRelegateCount: number
    relegationPlayoffCount: number
    autoPromoteCount: number
    promotionPlayoffCount: number
    /** Tier levels exempt from relegation (the bottom tier) and promotion (the top). */
    noRelegationFromTierLevels: readonly number[]
    noPromotionFromTierLevels: readonly number[]
  }
}

export type AdvancementPolicy = PolicyBase & {
  mode: 'tier_playoff' | 'bracket' | 'placement' | 'none'
}

export type GovernancePolicy = PolicyBase & {
  /** Rules the commissioner may change. Empty means the format fixes everything. */
  commissionerConfigurable: readonly string[]
  /** Modules this template will need but which do not exist yet. Named, not implied. */
  deferredModules?: readonly string[]
}

/**
 * How the template behaves on a league AllFantasy cannot write to.
 *
 * ⚠ THIS IS A CLAIM ABOUT BEHAVIOUR AND IT MUST BE TRUE. `deepLinkable` false means the Hub must
 * not render a "do it on Sleeper" button, because there is no page to send them to.
 */
export type ExternalPlatformBehavior = {
  /** Effects the template can still PREPARE on a read-only league. */
  preparableEffects: readonly RuleEffectType[]
  /** Effects that vanish entirely — no execute, no prepare, no guidance worth showing. */
  unsupportedEffects: readonly RuleEffectType[]
  deepLinkable: boolean
  notes?: readonly string[]
}

export type LeagueTemplateDefinition = {
  id: LeagueTemplateId
  /** Exact version. A league pins this; the registry never substitutes another. */
  version: string
  label: string
  description: string
  baseFormatId: LeagueFormatId
  /**
   * Alias tags a league of this template carries, matching what `normalizeConcept` would store.
   *
   * ⚠ ALIAS-PRESERVING BY CONSTRUCTION. The EFL template's base format is dynasty and that is NOT
   * the whole truth about it — the same flattening problem `readFormatRules` documents.
   */
  aliasTags: readonly string[]
  compatibleSports: readonly LeagueSport[]
  capabilityIds: readonly CommissionerCapabilityId[]
  defaultSettings: Readonly<Record<string, unknown>>
  phaseGraph: TemplatePhaseGraph
  scheduledEffects: readonly ScheduledRuleEffect[]
  eliminationPolicy?: EliminationPolicy
  rewardPolicy?: RewardPolicy
  powerPolicy?: PowerPolicy
  draftPolicy?: DraftPolicy
  standingsPolicy?: StandingsPolicy
  advancementPolicy?: AdvancementPolicy
  governancePolicy?: GovernancePolicy
  commissionerAutomationDefaults: CommissionerAutomationPolicy
  externalPlatformBehavior: ExternalPlatformBehavior
  /**
   * 🛑 `false` MEANS THIS TEMPLATE MUST NOT MUTATE A LEAGUE, AND THE PLANNER ENFORCES IT.
   *
   * Both launch templates are proof fixtures for the contract — they validate, they expose
   * capabilities, they carry phase and scheduled-effect metadata, and they plan actions that are
   * all marked non-executing. A fixture that could quietly execute is exactly the "demo-only data
   * called complete" failure the brief forbids, so this is a field the runtime reads rather than a
   * comment somebody has to remember.
   */
  executionEnabled: boolean
  /** The engines this template composes. The REUSE_MAP, machine-readable. */
  composedEngines: readonly string[]
}

/**
 * `id@version`. The only key form.
 *
 * ⚠ ACCEPTS A BARE `string` AS WELL AS A `LeagueTemplateId` ON PURPOSE. A pin read out of a
 * league's settings is untrusted text — it may name a template that was never published, which is
 * precisely the case the registry has to report rather than reject at the type level.
 */
export function templateKey(id: LeagueTemplateId | string, version: string): LeagueTemplateKey {
  return `${id}@${version}`
}

export type TemplateValidationIssue = { code: string; detail: string }

/**
 * Structural validation of a template definition.
 *
 * ⚠ THIS IS A POSITIVE CONTROL, NOT DECORATION. `__tests__/commissioner-os/templateContract.test.ts`
 * feeds it deliberately broken templates and asserts each specific issue code comes back. A
 * validator that has never returned an issue is not evidence that the fixtures are valid.
 */
export function validateTemplateDefinition(t: LeagueTemplateDefinition): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = []
  const phaseIds = new Set<string>()

  for (const p of t.phaseGraph.phases) {
    if (phaseIds.has(p.id)) {
      issues.push({ code: 'duplicate_phase_id', detail: p.id })
    }
    phaseIds.add(p.id)
  }
  if (!phaseIds.has(t.phaseGraph.initialPhaseId)) {
    issues.push({ code: 'initial_phase_missing', detail: t.phaseGraph.initialPhaseId })
  }
  for (const p of t.phaseGraph.phases) {
    for (const n of p.next) {
      if (!phaseIds.has(n)) {
        issues.push({ code: 'phase_next_missing', detail: `${p.id} -> ${n}` })
      }
    }
    if (p.terminal && p.next.length > 0) {
      issues.push({ code: 'terminal_phase_has_next', detail: p.id })
    }
    if (!p.terminal && p.next.length === 0) {
      issues.push({ code: 'dead_end_phase', detail: p.id })
    }
  }
  if (!t.phaseGraph.phases.some((p) => p.terminal)) {
    issues.push({ code: 'no_terminal_phase', detail: t.id })
  }

  const effectIds = new Set<string>()
  for (const e of t.scheduledEffects) {
    if (effectIds.has(e.id)) {
      issues.push({ code: 'duplicate_effect_id', detail: e.id })
    }
    effectIds.add(e.id)
    if (e.at.kind === 'phase_entry' || e.at.kind === 'phase_exit') {
      if (!phaseIds.has(e.at.phaseId)) {
        issues.push({ code: 'effect_phase_missing', detail: `${e.id} -> ${e.at.phaseId}` })
      }
    }
    if (e.at.kind === 'week' && (!Number.isInteger(e.at.week) || e.at.week < 1)) {
      issues.push({ code: 'effect_week_invalid', detail: `${e.id}` })
    }
  }

  if (t.compatibleSports.length === 0) {
    issues.push({ code: 'no_compatible_sports', detail: t.id })
  }
  if (t.capabilityIds.length === 0) {
    issues.push({ code: 'no_capabilities', detail: t.id })
  }
  if (!/^\d+\.\d+\.\d+$/.test(t.version)) {
    issues.push({ code: 'version_not_semver', detail: t.version })
  }

  return issues
}
