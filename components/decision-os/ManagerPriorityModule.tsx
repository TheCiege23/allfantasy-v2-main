'use client'
/**
 * Fantasy OS Suite — Phase OS-C2: Manager Priorities Alignment & Operating System Expansion.
 *
 * One generic module, instantiated 3× (Lineup/Trade/Waiver Priorities) by `ManagerCommandCenterSection`
 * — the "rule of three" consolidation this codebase applies from the start when a component is known
 * to have 3 near-identical occurrences up front (matching `SEVERITY_DOT_CLASS`/`ATTENTION_QUEUE_CAP`'s
 * own precedent, just applied proactively here instead of after a 3rd copy accumulated).
 *
 * Renders real, already-computed Phase 6.4 `Recommendation` objects (via `ManagerCommandCenterSnapshot
 * .recommendations` — the SAME data `deriveManagerAttentionSignals` already reads for the generic
 * Attention Queue), filtered to one real `RecommendationCategory`. No new derivation: severity reuses
 * `recommendation.priority` verbatim, the headline reuses the recommendation's own first
 * `recommendedActions[0].action`, and "why" reuses its own real `expectedImpact` — never invented text.
 *
 * Deliberately does NOT answer "what happens if you ignore it" — no `Recommendation` field honestly
 * supports that claim (`rollbackCriteria` is about withdrawing the recommendation itself, not a
 * consequence of inaction), and fabricating one would violate the "never fabricate" discipline this
 * whole workstream holds to. See `docs/os/OS_C2_PRIORITIES_ARCHITECTURE_AUDIT.md` §"Documented
 * technical debt" — a real, honest UX gap, not silently papered over.
 *
 * Showing the same recommendation here AND in the generic Attention Queue is intentional, not
 * duplication in the sense this phase's own UX principles prohibit — same precedent as
 * `CommissionerAttentionQueue`/`NotificationCenter` being kept as two distinct surfaces in OS-B6: a
 * read-only cross-domain priority glance next to a domain-specific actionable module.
 */
import type { LucideIcon } from 'lucide-react'
import { CheckCircle2 } from 'lucide-react'
import { SEVERITY_RANK, type AttentionSignalSeverity } from '@/lib/decision-os/attentionSignals'
import type { ManagerCommandCenterRecommendation } from '@/lib/decision-os/managerCommandCenter'
import type { RecommendationCategory } from '@/lib/decision-os/phase6/recommendations/types'
import { DecisionOsPanel, SEVERITY_DOT_CLASS } from './DecisionOsCardPrimitives'

type ManagerPriorityModuleProps = {
  title: string
  icon: LucideIcon
  category: RecommendationCategory
  entries: readonly ManagerCommandCenterRecommendation[]
  leagueNameById: Map<string, string>
  emptyMessage: string
  /** Caps how many entries render — a UX limit, independent of `MANAGER_RECOMMENDATIONS_CAP`'s own
   * payload-size safety ceiling. */
  limit?: number
}

const EVIDENCE_DISPLAY_CAP = 2

/** Phase OS-C3: found during the live-validation pass — the previous fallback (`?? title`) repeated
 * the panel's own title verbatim as an item's headline (e.g. "Lineup Priorities" as a list item under
 * a "Lineup Priorities (2)" panel), an uninformative duplicate. `deriveManagerAttentionSignals`
 * (`attentionSignals.ts`) already faces the identical "no recommendedActions" case for the same
 * `Recommendation` data and falls back to a humanized category label — this mirrors that treatment
 * for consistency, still zero invented text (the category is the recommendation's own real field). */
function humanizeCategory(category: string): string {
  const spaced = category.replace(/_/g, ' ')
  return spaced.length > 0 ? spaced[0].toUpperCase() + spaced.slice(1) : spaced
}

export default function ManagerPriorityModule({
  title,
  icon: Icon,
  category,
  entries,
  leagueNameById,
  emptyMessage,
  limit = 5,
}: ManagerPriorityModuleProps) {
  const matching = entries
    .filter((entry) => entry.recommendation.category === category)
    .slice()
    .sort((a, b) => {
      const aSeverity = SEVERITY_RANK[a.recommendation.priority as AttentionSignalSeverity] ?? 0
      const bSeverity = SEVERITY_RANK[b.recommendation.priority as AttentionSignalSeverity] ?? 0
      return bSeverity - aSeverity
    })
    .slice(0, limit)

  return (
    <DecisionOsPanel title={matching.length > 0 ? `${title} (${matching.length})` : title}>
      {matching.length === 0 ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-muted" data-testid={`manager-priority-${category}-empty`}>
          <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden />
          {emptyMessage}
        </div>
      ) : (
        <ul className="mt-2 space-y-2" data-testid={`manager-priority-${category}-list`}>
          {matching.map((entry) => {
            const { recommendation } = entry
            const headline = recommendation.recommendedActions[0]?.action ?? humanizeCategory(recommendation.category)
            const evidence = recommendation.evidence.slice(0, EVIDENCE_DISPLAY_CAP)
            return (
              <li
                key={recommendation.id}
                data-testid={`manager-priority-${category}-item-${recommendation.id}`}
                className="flex items-start gap-2 rounded-lg border border-subtle bg-surface px-3 py-2 text-sm"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0">
                  <p className="font-semibold text-primary">
                    {leagueNameById.get(entry.leagueId) ?? entry.leagueId}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs leading-5 text-secondary">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[recommendation.priority as AttentionSignalSeverity] ?? ''}`}
                      aria-hidden
                    />
                    {headline}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-secondary">{recommendation.expectedImpact}</p>
                  {evidence.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-[11px] leading-5 text-muted">
                      {evidence.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </DecisionOsPanel>
  )
}
