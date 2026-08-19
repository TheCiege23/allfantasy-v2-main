/**
 * Decision OS — Rule Modules for `manager.lineup.set` (Slice 1).
 *
 * The single legality entry point (validity BEFORE optimality, Inv. 17). It MERGES the legacy
 * validators behind one Rule Framework so callers stop invoking validators directly:
 *   - lib/redraft/lineupValidation (validateRedraftLineup)  ← composed here (reused, not rewritten)
 *   - rosterValidationService.validateCanonicalRosterPayload ← composed at the integration seam (DB),
 *     compared for parity before either legacy validator is retired.
 * Plus a new declarative lock-state rule. Pure; the legacy validator is injected so this unit-tests
 * without a DB.
 */
import type { RuleVerdict } from '@/lib/decision-os/core/decision'
import type { ResolvedRosterConfig, } from '@/lib/redraft/rosterConfigResolver'
import type {
  RedraftLineupPlayer,
  RedraftLineupValidationResult,
} from '@/lib/redraft/lineupValidation'
import { validateRedraftLineup } from '@/lib/redraft/lineupValidation'
import { compareValidatorParity, type ValidatorParity } from './validatorParity'
import type { LockState } from './world'

export interface LineupRuleContext {
  sport: string
  week: number
  players: RedraftLineupPlayer[]
  rosterConfig: ResolvedRosterConfig
  lockState: LockState
}

export interface LineupRuleDeps {
  /** Canonical redraft legality (reused, not rewritten). */
  validateRedraft: (args: {
    sport: string
    week: number
    players: RedraftLineupPlayer[]
    rosterConfig?: ResolvedRosterConfig
  }) => RedraftLineupValidationResult
  /**
   * Composition seam (BEGUN, not retiring anything): the second canonical validator
   * (rosterValidationService.validateCanonicalRosterPayload) composed behind the Rule Framework.
   * When provided, its verdicts merge in. Wiring it (needs a canonical roster payload + template)
   * and proving DB-level parity is the gate before either legacy validator is retired.
   */
  validateCanonical?: (ctx: LineupRuleContext) => RuleVerdict[]
}

export const defaultLineupRuleDeps: LineupRuleDeps = { validateRedraft: validateRedraftLineup }

/** Map a legacy validation issue → a Rule Framework verdict. */
function issueToVerdict(i: RedraftLineupValidationResult['issues'][number]): RuleVerdict {
  return {
    rule: `lineup.legality.${i.code}`,
    verdict: i.severity === 'error' ? 'illegal' : 'legal',
    message: i.message,
    severity: i.severity === 'error' ? 'critical' : 'warning',
  }
}

/** New declarative rule: editing a locked lineup is temporarily illegal. */
function lockRule(ctx: LineupRuleContext): RuleVerdict[] {
  if (!ctx.lockState.locked) return []
  return [
    {
      rule: 'lineup.lock.editing_locked',
      verdict: 'temporarily_illegal',
      message: ctx.lockState.reason ?? 'Lineup is locked for this scoring period.',
      severity: 'warning',
    },
  ]
}

/**
 * Evaluate all lineup Rule Modules → verdicts (the Valid Action Space gate). Composes the canonical
 * legacy validator + the lock rule. Pure (validateRedraft is injected).
 */
/**
 * The ACTIVE legality gate: the primary validator (validateRedraftLineup) + the lock rule. This is
 * what the decision consumes — its behavior is UNCHANGED by the canonical-validator composition
 * (the canonical validator is parity-only, see evaluateLineupRulesWithParity). Pure.
 */
export function evaluateLineupRules(ctx: LineupRuleContext, deps: LineupRuleDeps = defaultLineupRuleDeps): RuleVerdict[] {
  const legacy = deps.validateRedraft({ sport: ctx.sport, week: ctx.week, players: ctx.players, rosterConfig: ctx.rosterConfig })
  return [...legacy.issues.map(issueToVerdict), ...lockRule(ctx)]
}

export interface LineupRuleEvaluation {
  /** The active gate (primary validator + lock) — unchanged behavior. */
  verdicts: RuleVerdict[]
  /** The second (canonical) validator's verdicts, for parity only — NOT part of the active gate. */
  canonicalVerdicts: RuleVerdict[]
  parity: ValidatorParity
  /** Convenience mirror of parity.retirementSafe. */
  retirementSafe: boolean
}

/**
 * Run BOTH validators and report parity WITHOUT changing the active gate. The canonical validator is
 * wrapped in try/catch so it can never break the decision (parity records the error instead).
 */
export function evaluateLineupRulesWithParity(ctx: LineupRuleContext, deps: LineupRuleDeps = defaultLineupRuleDeps): LineupRuleEvaluation {
  const verdicts = evaluateLineupRules(ctx, deps)
  let canonicalVerdicts: RuleVerdict[] = []
  let canonicalError: string | undefined
  try {
    canonicalVerdicts = deps.validateCanonical?.(ctx) ?? []
  } catch (e) {
    canonicalError = e instanceof Error ? e.message : 'canonical_validator_error'
  }
  const parity = compareValidatorParity(verdicts, canonicalVerdicts, canonicalError)
  return { verdicts, canonicalVerdicts, parity, retirementSafe: parity.retirementSafe }
}

// ── Parity ───────────────────────────────────────────────────────────────────

export interface LegalityParity {
  passed: boolean
  diffs: string[]
}

/**
 * Parity: the Rule Framework's legality verdicts must match the legacy validator's error set
 * (codes). The lock rule is additive and excluded from this comparison. Used in shadow mode before
 * retiring `validateRedraftLineup`.
 */
export function compareLegalityParity(verdicts: RuleVerdict[], legacy: RedraftLineupValidationResult): LegalityParity {
  const rfIllegal = new Set(
    verdicts
      .filter((v) => v.verdict === 'illegal' && v.rule.startsWith('lineup.legality.'))
      .map((v) => v.rule.replace('lineup.legality.', '')),
  )
  const legacyErrors = new Set(legacy.issues.filter((i) => i.severity === 'error').map((i) => i.code))
  const diffs: string[] = []
  for (const code of legacyErrors) if (!rfIllegal.has(code)) diffs.push(`missing in Rule Framework: ${code}`)
  for (const code of rfIllegal) if (!legacyErrors.has(code)) diffs.push(`extra in Rule Framework: ${code}`)
  return { passed: diffs.length === 0, diffs }
}
