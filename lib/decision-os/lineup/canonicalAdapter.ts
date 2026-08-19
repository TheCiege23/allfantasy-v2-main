/**
 * Decision OS — canonical validator adapter for `manager.lineup.set` (Slice 1, Ticket #5).
 *
 * Bridges the second legacy validator (rosterValidationService.validateCanonicalRosterPayload) into
 * the Rule Framework's `validateCanonical` seam: converts the Decision OS lineup players into the
 * canonical Roster.playerData section shape and maps its result into RuleVerdicts. Pure; the real
 * validator + the loaded ctx (template + league flags) are injected at the route seam (deps.ts).
 */
import type { RuleVerdict } from '@/lib/decision-os/core/decision'
import type { RedraftLineupPlayer } from '@/lib/redraft/lineupValidation'
import type { LineupRuleContext } from './rules'

export interface CanonicalResultLike {
  ok: boolean
  issues: { code: string; message: string; section?: string; playerId?: string }[]
}

/** Canonical issues are hard legality → illegal verdicts under the `lineup.canonical.*` namespace. */
export function canonicalResultToVerdicts(result: CanonicalResultLike): RuleVerdict[] {
  return result.issues.map((i) => ({
    rule: `lineup.canonical.${i.code}`,
    verdict: 'illegal' as const,
    message: i.message,
    severity: 'critical' as const,
  }))
}

/**
 * Best-effort converter: Decision OS lineup players → the canonical Roster.playerData sections shape
 * that getNormalizedLineupSections parses. Verified against real data at the staging seam (like the
 * loader); tests inject a fake validator and bypass this.
 */
export function toCanonicalPlayerData(players: RedraftLineupPlayer[]): unknown {
  const sections: Record<string, unknown[]> = { starters: [], bench: [], ir: [], taxi: [], devy: [] }
  for (const p of players) {
    const slot = String(p.slotType ?? '').toUpperCase()
    const row = { id: p.playerId, position: p.position, status: (p as { injuryStatus?: string }).injuryStatus ?? null }
    if (slot === 'BENCH' || slot === 'BN') sections.bench.push(row)
    else if (slot === 'IR' || slot === 'RESERVE') sections.ir.push(row)
    else if (slot === 'TAXI') sections.taxi.push(row)
    else if (slot === 'DEVY') sections.devy.push(row)
    else sections.starters.push(row)
  }
  return sections
}

/**
 * Build the `validateCanonical` Rule Framework dependency from the real canonical validator + a
 * loaded canonical context (template + league flags). The validator and ctx are injected so this
 * stays pure and unit-testable.
 */
export function buildCanonicalValidatorDep(deps: {
  validate: (playerData: unknown, ctx: unknown) => CanonicalResultLike
  ctx: unknown
}): (ruleCtx: LineupRuleContext) => RuleVerdict[] {
  return (ruleCtx) => canonicalResultToVerdicts(deps.validate(toCanonicalPlayerData(ruleCtx.players), deps.ctx))
}
