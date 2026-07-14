/**
 * Commissioner Divergence Analyzer — Phase 10.
 *
 * Per the brief: "Do not force a shadow comparison where no comparable
 * existing engine exists." The one genuinely meaningful, honest comparison
 * found: lib/decision-os/attentionQueue.ts's resolveAttentionQueueSnapshot()
 * is a REAL, separately-composed resolver that wires real
 * draftDateUtc/financialStatus inputs into the SAME deriveLeagueAttentionSignals()
 * this module's own CommissionerAttentionService.ts calls — but that service
 * currently passes documented placeholders (financialStatus:'UNKNOWN',
 * draftDateUtc:null) rather than resolving those real inputs itself. Diverging
 * against resolveAttentionQueueSnapshot's real output is therefore not a
 * synthetic comparison — it directly measures the real, documented gap in
 * this foundation phase's own attention service, most visibly via
 * `draft_approaching` signals that can only ever fire in the real resolver.
 *
 * league_health_status_mismatch/stale_data_handling_mismatch are declared in
 * CommissionerDivergenceCategory for future use (e.g. once financialStatus is
 * wired) but not produced by this pass — documented, not silently omitted.
 */

import { resolveAttentionQueueSnapshot } from '@/lib/decision-os/attentionQueue'
import type { CommissionerAttentionItem, CommissionerDivergenceItem } from './types'

export async function analyzeCommissionerDivergence(input: {
  leagueId: string
  myAttentionItems: CommissionerAttentionItem[]
}): Promise<CommissionerDivergenceItem[]> {
  const divergence: CommissionerDivergenceItem[] = []

  const real = await resolveAttentionQueueSnapshot([input.leagueId])
  const realTypes = new Set(real.signals.map((s) => s.type))
  const myTypes = new Set(input.myAttentionItems.filter((i) => i.reasonCode === 'legacy_signal').map((i) => i.category))

  for (const type of realTypes) {
    if (!myTypes.has(type)) {
      divergence.push({
        category: 'missing_signal',
        leagueId: input.leagueId,
        primaryValue: null,
        legacyValue: type,
        notes: [`resolveAttentionQueueSnapshot flagged "${type}" (using real draftDateUtc/financialStatus inputs) — this service's simplified inputs did not produce it.`],
      })
    }
  }

  const realByType = new Map<string, (typeof real.signals)[number]>(real.signals.map((s) => [s.type, s]))
  for (const item of input.myAttentionItems) {
    if (item.reasonCode !== 'legacy_signal') continue
    const realSignal = realByType.get(item.category)
    if (realSignal && realSignal.severity !== item.severity) {
      divergence.push({
        category: 'severity_mismatch',
        leagueId: input.leagueId,
        primaryValue: item.severity,
        legacyValue: realSignal.severity,
        notes: [`Both flagged "${item.category}" but with different severity — likely due to this service's placeholder financialStatus/draftDateUtc inputs.`],
      })
    }
  }

  return divergence
}
