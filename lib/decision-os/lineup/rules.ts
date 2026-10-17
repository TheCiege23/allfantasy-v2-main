/**
 * Decision OS — Rule Modules for `manager.lineup.set` (Slice 1).
 *
 * The single legality entry point (validity BEFORE optimality, Inv. 17): the redraft validator
 * (lib/redraft/lineupValidation `validateRedraftLineup`, reused, not rewritten) plus a declarative
 * lock-state rule. Pure; the validator is injected so this unit-tests without a DB.
 *
 * The second-validator PARITY composition (`evaluateLineupRulesWithParity`, the `validateCanonical`
 * seam, `validatorParity.ts`, `canonicalAdapter.ts`) was deleted 2026-09-29 with the lineup shadow
 * runner — its only caller. See `./index.ts`.
 */
import type { RuleVerdict } from '@/lib/decision-os/core/decision'
import type { ResolvedRosterConfig, } from '@/lib/redraft/rosterConfigResolver'
import type {
  RedraftLineupPlayer,
  RedraftLineupValidationResult,
} from '@/lib/redraft/lineupValidation'
import { validateRedraftLineup } from '@/lib/redraft/lineupValidation'
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
 * what the decision consumes. Pure.
 */
export function evaluateLineupRules(ctx: LineupRuleContext, deps: LineupRuleDeps = defaultLineupRuleDeps): RuleVerdict[] {
  const legacy = deps.validateRedraft({ sport: ctx.sport, week: ctx.week, players: ctx.players, rosterConfig: ctx.rosterConfig })
  return [...legacy.issues.map(issueToVerdict), ...lockRule(ctx)]
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
