/**
 * The template runtime — turns a pinned template's declared effects into planned actions.
 *
 * 🛑 IT PLANS. IT DOES NOT EXECUTE, AND IT CANNOT BE MADE TO IN THIS PHASE. Every action comes back
 * carrying an `authority` verdict, and a template whose `executionEnabled` is false has
 * `canExecute: false` forced on every one of them regardless of platform or role. Both launch
 * templates are proof fixtures with that flag off.
 *
 * That is the same posture the existing specialty pipeline already takes: `persistAutomationActions`
 * writes `AutomationAction` ROWS and nothing applies them. This module produces the same
 * `actionType` strings so those rows stay readable by everything that already reads them.
 *
 * ## Determinism
 *
 * ⚠ NO CLOCK, NO RANDOMNESS, NO SET ITERATION ORDER, NO DB. Same inputs, byte-identical output —
 * asserted in `__tests__/commissioner-os/templateRuntime.test.ts` by planning twice and comparing
 * serialised results. The one place the format genuinely needs randomness (the week 7 tribe shuffle)
 * is planned as an action that REQUIRES A SEED from its executor rather than rolled here; a planner
 * that rolled dice would produce a different plan from the same inputs and idempotency would be
 * meaningless.
 *
 * ## Idempotency
 *
 * 🛑 THE KEY IS SCOPED TO league + season + PINNED TEMPLATE VERSION + effect + occurrence, AND EVERY
 * PART IS LOAD-BEARING. Dropping the version would let a rules change re-fire an effect that already
 * ran under the old ruleset. Dropping the occurrence would collapse the Gauntlet's three weekly
 * double eliminations into one — which is not a duplicate-suppression win, it is six teams that
 * never leave.
 *
 * ⚠ THE KEY DELIBERATELY EXCLUDES THE TRIGGER. `buildIdempotencyKey` in the specialty pipeline
 * includes it, correctly, because there it identifies one automation PASS. Here the unit is "this
 * scheduled effect, once per season", and a week-11 elimination reached through `onWeekFinalized`
 * and again through `onManualRun` is the same event — including the trigger would let a manual
 * re-run plan it a second time under a fresh key.
 */

import type { AutomationTrigger, PlannedEvent } from '@/lib/specialty-automation/types'
import { getRuleEffect, type RuleEffectType } from '@/lib/commissioner-os/ruleEffects'
import { resolveActionAuthority, type ActionAuthority } from '@/lib/commissioner-os/authority'
import type { CommissionerLeagueProfile } from '@/lib/commissioner-os/profile/types'
import { templateKey, type LeagueTemplateDefinition, type ScheduledRuleEffect } from '@/lib/commissioner-os/template/types'

/**
 * A planned action, in the shape the specialty pipeline already persists, plus the three verdicts
 * the C5 brief requires.
 *
 * Structurally assignable to `PlannedAction` — `actionType`, `targetType`, `targetId`, `metadata` —
 * so it can be handed to `persistAutomationActions` unchanged when executors eventually exist.
 */
export type PlannedTemplateAction = {
  actionType: string
  targetType?: string
  targetId?: string
  metadata: Record<string, unknown>

  effectId: string
  effectType: RuleEffectType
  idempotencyKey: string
  /** `w11`, `gauntlet:entry`, `season_end`. Unique with `effectId` inside one season. */
  occurrence: string
  authority: ActionAuthority
  /** True only when the effect has a real executor AND the template permits execution. */
  executable: boolean
  description: string
}

export type TemplatePlan = {
  leagueId: string
  season: number
  templateKey: string
  templateVersion: string
  /** Mirrors the template flag. A surface must not offer an Execute control when false. */
  executionEnabled: boolean
  actions: PlannedTemplateAction[]
  events: PlannedEvent[]
  warnings: string[]
  skipped: boolean
  skipReason?: string
}

export type PlanTemplateActionsInput = {
  profile: CommissionerLeagueProfile
  template: LeagueTemplateDefinition
  trigger: AutomationTrigger
  season: number
  /** Scoring period being evaluated. Omit (with `currentPhaseId`) to plan the whole season. */
  week?: number | null
  currentPhaseId?: string | null
}

/**
 * Expand one declared effect into its occurrences.
 *
 * ⚠ `params.weeks` IS WHAT MAKES A PHASE-SCOPED EFFECT RECURRING. The Gauntlet's double elimination
 * is declared once, entering the `gauntlet` phase, with `weeks: [11, 12, 13]` — three occurrences,
 * three keys, three eliminations. Without this the same declaration would plan once and the format
 * would be short by six departures.
 */
function occurrencesOf(effect: ScheduledRuleEffect): { occurrence: string; week: number | null }[] {
  const declaredWeeks = Array.isArray(effect.params?.weeks)
    ? (effect.params!.weeks as unknown[]).filter((w): w is number => Number.isInteger(w))
    : null

  if (effect.at.kind === 'week') {
    return [{ occurrence: `w${effect.at.week}`, week: effect.at.week }]
  }
  if (effect.at.kind === 'season_end') {
    return [{ occurrence: 'season_end', week: null }]
  }
  const suffix = effect.at.kind === 'phase_entry' ? 'entry' : 'exit'
  if (declaredWeeks && declaredWeeks.length > 0) {
    return declaredWeeks.map((w) => ({ occurrence: `w${w}`, week: w }))
  }
  return [{ occurrence: `${effect.at.phaseId}:${suffix}`, week: null }]
}

/** Whether this occurrence is due for the week/phase being evaluated. */
function isDue(
  effect: ScheduledRuleEffect,
  occurrenceWeek: number | null,
  week: number | null | undefined,
  currentPhaseId: string | null | undefined,
): boolean {
  // Whole-season plan: nothing is filtered out.
  if (week == null && currentPhaseId == null) return true

  if (occurrenceWeek != null && week != null) return occurrenceWeek === week
  if (effect.at.kind === 'phase_entry' || effect.at.kind === 'phase_exit') {
    return currentPhaseId != null && effect.at.phaseId === currentPhaseId
  }
  return false
}

function buildKey(input: {
  leagueId: string
  season: number
  key: string
  effectId: string
  occurrence: string
}): string {
  return `commissioner-os:${input.leagueId}:${input.season}:${input.key}:${input.effectId}:${input.occurrence}`
}

export function planTemplateActions(input: PlanTemplateActionsInput): TemplatePlan {
  const { profile, template, season, week, currentPhaseId } = input
  const key = templateKey(template.id, template.version)

  const base: TemplatePlan = {
    leagueId: profile.leagueId,
    season,
    templateKey: key,
    templateVersion: template.version,
    executionEnabled: template.executionEnabled,
    actions: [],
    events: [],
    warnings: [],
    skipped: false,
  }

  /*
   * 🛑 A SPORT MISMATCH SKIPS THE WHOLE PLAN RATHER THAN PLANNING WHAT IT CAN. A template's phase
   * graph and week numbers are written against one sport's calendar; running its week-9 SUPERFLEX
   * expansion on an NBA league would be arithmetic against a season that does not have that shape.
   */
  if (profile.sport && !template.compatibleSports.includes(profile.sport)) {
    return {
      ...base,
      skipped: true,
      skipReason: `Template ${key} does not support ${profile.sport}.`,
    }
  }

  const warnings: string[] = []
  if (!template.executionEnabled) {
    warnings.push(
      `Template ${key} is a non-executing definition. Every action below is guidance; nothing will be applied.`,
    )
  }
  if (profile.resolution === 'degraded') {
    warnings.push(
      `League profile is degraded (${profile.degradedReasons.join(', ')}). Plan is based on what could be resolved.`,
    )
  }

  const actions: PlannedTemplateAction[] = []

  for (const effect of template.scheduledEffects) {
    const definition = getRuleEffect(effect.effect)
    const unsupported = template.externalPlatformBehavior.unsupportedEffects.includes(effect.effect)

    for (const occ of occurrencesOf(effect)) {
      if (!isDue(effect, occ.week, week, currentPhaseId)) continue

      /*
       * ⚠ `preparable` FOLDS IN THE TEMPLATE'S OWN CLAIM. An effect the template lists as
       * unsupported on an external platform must not come back as "prepared for you" — `AWARD_FAAB`
       * on an imported league would be arithmetic on a balance AllFantasy cannot see.
       */
      const authority = resolveActionAuthority({
        platform: profile.platform,
        scope: definition.scope,
        verifiableFromImport: definition.verifiableFromImport,
        preparable: !unsupported,
      })

      /*
       * ⚠ THE TEMPLATE'S OWN CLAIM WINS OVER THE GLOBAL VOCABULARY, IN BOTH DIRECTIONS. See
       * `ScheduledRuleEffect.backedBy` — EFL widens `ASSIGN_DRAFT_SLOT` (it really does compute the
       * order) and narrows `PROMOTE_TEAM` (its playoff-decided movement has no applier, even though
       * the generic standings-zone one does).
       */
      const executorStatus = effect.backedBy?.status ?? definition.executorStatus
      const canonicalEngine = effect.backedBy?.engine ?? definition.canonicalEngine

      /*
       * 🛑 THREE INDEPENDENT CONDITIONS, ALL REQUIRED. The template must permit execution, the
       * effect must have a real executor, and the platform must accept the write. Any one of them
       * false and this is guidance. Collapsing them would let a fixture with no executor render an
       * Execute button on a native league.
       */
      const executable =
        template.executionEnabled && executorStatus === 'engine' && authority.canExecute

      actions.push({
        actionType: definition.actionType,
        metadata: {
          templateId: template.id,
          templateVersion: template.version,
          effectId: effect.id,
          effectType: effect.effect,
          occurrence: occ.occurrence,
          week: occ.week,
          executorStatus,
          canonicalEngine,
          backedByNote: effect.backedBy?.note ?? null,
          ...(effect.params ?? {}),
        },
        effectId: effect.id,
        effectType: effect.effect,
        idempotencyKey: buildKey({
          leagueId: profile.leagueId,
          season,
          key,
          effectId: effect.id,
          occurrence: occ.occurrence,
        }),
        occurrence: occ.occurrence,
        authority,
        executable,
        description: effect.description,
      })

      if (executorStatus === 'none') {
        warnings.push(`${effect.id}: no executor exists for ${effect.effect}. Guidance only.`)
      }
    }
  }

  /*
   * ⚠ SORTED BY (week, effectId, occurrence) SO THE OUTPUT ORDER IS A FUNCTION OF THE INPUT, not of
   * declaration order in the template file. Reordering a template's `scheduledEffects` array is an
   * editorial change and must not change a plan.
   */
  actions.sort((a, b) => {
    const aw = typeof a.metadata.week === 'number' ? a.metadata.week : Number.MAX_SAFE_INTEGER
    const bw = typeof b.metadata.week === 'number' ? b.metadata.week : Number.MAX_SAFE_INTEGER
    if (aw !== bw) return aw - bw
    if (a.effectId !== b.effectId) return a.effectId < b.effectId ? -1 : 1
    return a.occurrence < b.occurrence ? -1 : a.occurrence > b.occurrence ? 1 : 0
  })

  return { ...base, actions, warnings }
}
