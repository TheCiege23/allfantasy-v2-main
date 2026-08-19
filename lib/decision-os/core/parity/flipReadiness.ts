/**
 * Decision OS — flip-readiness aggregation (Slice 10).
 *
 * Turns raw `decision.shadow_parity` events into the per-surface summary the
 * Phase 3 gate is defined on (AF_TRADE_UNIFICATION_BRIEF: flip a surface when
 * agreement holds at ≥95% over ≥50 real comparisons, divergences triaged).
 * Pure over already-collected events; the route decides where events come from.
 *
 * Agreement signal per event (first present wins):
 *   - flags.agreement      (trade value_engine_compare)
 *   - flags.sameTopPlayer  (draft shared_service_compare)
 * Events with neither, or with a null signal, count as comparisons without a
 * verdict and are reported separately — never silently counted as agreement.
 */
import type { DecisionTelemetryDebugEvent } from '../telemetryDebugStore'

export interface SurfaceParitySummary {
  decisionType: string
  surface: string
  totalEvents: number
  comparisons: number
  agreements: number
  disagreements: number
  verdictlessComparisons: number
  skips: number
  skipReasons: Record<string, number>
  /** agreements / (agreements + disagreements); null until at least one verdict exists. */
  agreementRate: number | null
  readiness: 'ready' | 'accumulating' | 'no_signal'
  gate: { minComparisons: number; minAgreementRate: number }
}

const DEFAULT_MIN_COMPARISONS = 50
const DEFAULT_MIN_AGREEMENT = 0.95

function agreementSignal(flags: Record<string, unknown> | undefined): boolean | null {
  if (!flags) return null
  if (typeof flags.agreement === 'boolean') return flags.agreement
  if (typeof flags.sameTopPlayer === 'boolean') return flags.sameTopPlayer
  return null
}

export function summarizeFlipReadiness(
  events: DecisionTelemetryDebugEvent[],
  opts: { minComparisons?: number; minAgreementRate?: number } = {},
): SurfaceParitySummary[] {
  const minComparisons = opts.minComparisons ?? DEFAULT_MIN_COMPARISONS
  const minAgreementRate = opts.minAgreementRate ?? DEFAULT_MIN_AGREEMENT

  const groups = new Map<string, SurfaceParitySummary>()
  for (const event of events) {
    if (event.event !== 'decision.shadow_parity') continue
    const flags = event.flags as Record<string, unknown> | undefined
    const surface = typeof flags?.surface === 'string' && flags.surface ? flags.surface : 'default'
    const key = `${event.decision_type}|${surface}`
    let group = groups.get(key)
    if (!group) {
      group = {
        decisionType: event.decision_type,
        surface,
        totalEvents: 0,
        comparisons: 0,
        agreements: 0,
        disagreements: 0,
        verdictlessComparisons: 0,
        skips: 0,
        skipReasons: {},
        agreementRate: null,
        readiness: 'no_signal',
        gate: { minComparisons, minAgreementRate },
      }
      groups.set(key, group)
    }

    group.totalEvents += 1
    if (flags?.ran === true) {
      group.comparisons += 1
      const signal = agreementSignal(flags)
      if (signal === true) group.agreements += 1
      else if (signal === false) group.disagreements += 1
      else group.verdictlessComparisons += 1
    } else {
      group.skips += 1
      const reason = typeof flags?.reason === 'string' && flags.reason ? flags.reason : 'unknown'
      group.skipReasons[reason] = (group.skipReasons[reason] ?? 0) + 1
    }
  }

  for (const group of groups.values()) {
    const verdicts = group.agreements + group.disagreements
    group.agreementRate = verdicts > 0 ? group.agreements / verdicts : null
    group.readiness =
      verdicts >= minComparisons && (group.agreementRate ?? 0) >= minAgreementRate
        ? 'ready'
        : group.comparisons > 0
          ? 'accumulating'
          : 'no_signal'
  }

  return [...groups.values()].sort(
    (a, b) => a.decisionType.localeCompare(b.decisionType) || a.surface.localeCompare(b.surface),
  )
}
