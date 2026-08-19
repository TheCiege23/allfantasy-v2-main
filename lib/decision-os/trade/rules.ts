/**
 * Decision OS — Rule Modules for `manager.trade.evaluate` (Slice 3).
 *
 * The single legality entry point (validity BEFORE optimality). READ-ONLY: it evaluates whether a
 * proposed trade is legal WITHOUT mutating any trade/roster state. Deterministic World rules
 * (deadline, FAAB sufficiency) plus an INJECTED legality validator (the existing trade validation,
 * caught + mapped if it throws — production throw behavior unchanged). Pure given injected deps.
 */
import type { RuleVerdict, RuleVerdictType, VerdictSeverity } from '@/lib/decision-os/core/decision'
import { compareValidatorParity, type ValidatorParity, type ValidatorParityConfig } from '@/lib/decision-os/core/parity'
import type { TradeWorld } from './world'
import type { TradeAssetSummary } from './dco'

export type TradeRuleCategory =
  | 'trade_deadline_passed'
  | 'player_locked'
  | 'faab_insufficient'
  | 'roster_legality'
  | 'asset_direction_invalid'
  | 'missing_snapshot'
  | 'missing_roster'
  | 'execution_forbidden'

export interface TradeRuleContext {
  world: TradeWorld
  assets: TradeAssetSummary[]
  snapshotAvailable: boolean
}

export interface TradeRuleDeps {
  /**
   * Canonical trade legality (reused, not rewritten). THROWS a user-facing Error on violation; resolves
   * on legality. READ-ONLY (must never mutate trade/roster state). Production wires the existing trade
   * validation; tests fake it. Optional — when absent only the deterministic World rules run.
   */
  assertLegality?: (ctx: TradeRuleContext) => Promise<void> | void
  /**
   * Composition seam (parity only, NOT the active gate): a SECOND validator → verdicts. When provided,
   * compared for parity. Composed, never retired.
   */
  validateCanonical?: (ctx: TradeRuleContext) => RuleVerdict[]
}

const TEMPORARY: ReadonlySet<TradeRuleCategory> = new Set(['trade_deadline_passed'])

function verdictFor(category: TradeRuleCategory, message: string): RuleVerdict {
  const temporary = TEMPORARY.has(category)
  const verdict: RuleVerdictType = temporary ? 'temporarily_illegal' : 'illegal'
  const severity: VerdictSeverity = temporary ? 'warning' : 'critical'
  return { rule: `trade.legality.${category}`, verdict, message, severity }
}

/** Map a thrown trade-legality message → a normalized category (pure). */
export function categorizeTradeFailure(message: string): TradeRuleCategory {
  const m = message.toLowerCase()
  if (m.includes('deadline')) return 'trade_deadline_passed'
  if (m.includes('locked')) return 'player_locked'
  if (m.includes('faab')) return 'faab_insufficient'
  if (m.includes('direction') || m.includes('roster direction')) return 'asset_direction_invalid'
  if (m.includes('not found') || m.includes('roster not')) return 'missing_roster'
  if (m.includes('illegal') || m.includes('roster size') || m.includes('ineligible')) return 'roster_legality'
  return 'roster_legality'
}

/** Deterministic World rule: trade deadline passed → temporarily illegal. */
function deadlineRule(ctx: TradeRuleContext): RuleVerdict[] {
  if (!ctx.world.deadline.passed) return []
  return [verdictFor('trade_deadline_passed', `Trade deadline (week ${ctx.world.deadline.week}) has passed.`)]
}

/** Deterministic World rule: a FAAB asset exceeding the sending roster's balance → illegal.
 *  Iterates ALL participants (multi-team capable); unknown rosters are skipped (can't verify). */
function faabRule(ctx: TradeRuleContext): RuleVerdict[] {
  const balanceByRoster: Record<string, number | null> = {}
  for (const p of ctx.world.participants) balanceByRoster[p.rosterId] = p.faabBalance
  const out: RuleVerdict[] = []
  for (const a of ctx.assets) {
    if (a.assetType !== 'faab' || a.faabAmount == null) continue
    const bal = balanceByRoster[a.fromRosterId]
    if (bal != null && a.faabAmount > bal) {
      out.push(verdictFor('faab_insufficient', `FAAB amount ${a.faabAmount} exceeds the sending roster's balance ${bal}.`))
    }
  }
  return out
}

/** Defensive: the evaluation depends on the deterministic snapshot being available. */
function snapshotRule(ctx: TradeRuleContext): RuleVerdict[] {
  if (ctx.snapshotAvailable) return []
  return [verdictFor('missing_snapshot', 'Deterministic value snapshot is unavailable; evaluation is incomplete.')]
}

/**
 * The ACTIVE legality gate: deterministic World rules + the caught legality validator. READ-ONLY —
 * this NEVER mutates trade/roster state. Its behavior is UNCHANGED by the parity composition.
 */
export async function evaluateTradeRules(ctx: TradeRuleContext, deps: TradeRuleDeps): Promise<RuleVerdict[]> {
  const verdicts: RuleVerdict[] = [...deadlineRule(ctx), ...faabRule(ctx), ...snapshotRule(ctx)]
  if (deps.assertLegality) {
    try {
      await deps.assertLegality(ctx)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'This trade is not legal.'
      verdicts.push(verdictFor(categorizeTradeFailure(message), message))
    }
  }
  return verdicts
}

// ── Validator parity (compose a second validator, never retire) ─────────────────

const TRADE_PARITY_CONFIG: ValidatorParityConfig = {
  categoryFor: (v) => {
    const m = /^trade\.(?:legality|canonical)\.(.+)$/.exec(v.rule)
    return m ? m[1] : v.rule
  },
  sharedCategories: new Set<string>(['faab_insufficient', 'roster_legality', 'player_locked', 'trade_deadline_passed']),
}

export interface TradeRuleEvaluation {
  verdicts: RuleVerdict[]
  canonicalVerdicts: RuleVerdict[]
  parity: ValidatorParity
  retirementSafe: boolean
}

/** Run BOTH validators and report parity WITHOUT changing the active gate. Canonical is try/caught. */
export async function evaluateTradeRulesWithParity(ctx: TradeRuleContext, deps: TradeRuleDeps): Promise<TradeRuleEvaluation> {
  const verdicts = await evaluateTradeRules(ctx, deps)
  let canonicalVerdicts: RuleVerdict[] = []
  let canonicalError: string | undefined
  try {
    canonicalVerdicts = deps.validateCanonical?.(ctx) ?? []
  } catch (e) {
    canonicalError = e instanceof Error ? e.message : 'canonical_validator_error'
  }
  const parity = compareValidatorParity(verdicts, canonicalVerdicts, TRADE_PARITY_CONFIG, canonicalError)
  return { verdicts, canonicalVerdicts, parity, retirementSafe: parity.retirementSafe }
}
