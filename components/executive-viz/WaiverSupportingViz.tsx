'use client'

/**
 * Fantasy OS Suite — Phase V2.5: Waiver OS supporting executive visualizations.
 *
 *   - WaiverOpportunityImpactCard → "Which waiver opportunities could make the largest difference?"
 *   - WaiverUrgencyCard           → "Which decisions cannot wait?"
 *
 * Both read the waiver-category recommendations already carried by `ManagerCommandCenterSnapshot`.
 * Impact is expressed with the engine's OWN priority ordinal — no impact score is invented.
 *
 * "Resource Strategy" (FAAB budget / bid range / waiver priority) is intentionally NOT built: those
 * fields exist in the real `WaiverResourceIntel` contract but no customer-facing route exposes them, so
 * rendering them would require backend expansion and any number shown would be fabricated. See
 * EXECUTIVE_VISUALIZATION_ENGINE.md §Phase V2.5 (deferred work).
 */
import { useMemo } from 'react'
import { BarChart3, Timer } from 'lucide-react'
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import {
  buildWaiverOpportunityImpact,
  buildWaiverUrgency,
} from '@/lib/executive-viz/waiverDecisionViewModel'
import { ExecutiveHorizontalBars, ExecutiveProgressRing } from './ExecutiveCharts'
import {
  ExecutiveEmptyState,
  ExecutiveUnavailableState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

export function WaiverOpportunityImpactCard({ snapshot }: { snapshot: ManagerCommandCenterSnapshot | null }) {
  const model = useMemo(() => buildWaiverOpportunityImpact(snapshot), [snapshot])
  return (
    <ExecutiveVisualizationShell
      title="Opportunity Impact"
      description="Where the biggest waiver gains sit, by priority."
      icon={BarChart3}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Waiver opportunities appear once a league is connected and synced." />
      ) : model.items.length === 0 ? (
        <ExecutiveEmptyState
          icon={BarChart3}
          title="No opportunities to weigh"
          description="No waiver recommendations are open across your teams right now."
        />
      ) : (
        <>
          <p className="mb-3 text-[12px] font-semibold text-secondary">{model.headline}</p>
          <ExecutiveHorizontalBars items={model.items} />
        </>
      )}
    </ExecutiveVisualizationShell>
  )
}

export function WaiverUrgencyCard({ snapshot }: { snapshot: ManagerCommandCenterSnapshot | null }) {
  const model = useMemo(() => buildWaiverUrgency(snapshot), [snapshot])
  return (
    <ExecutiveVisualizationShell
      title="Waiver Urgency"
      description="Which decisions cannot wait."
      icon={Timer}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Waiver urgency appears once a league is connected and synced." />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <ExecutiveProgressRing
            value={model.urgentPct}
            status={model.status}
            label={model.totalCount > 0 ? 'Cannot wait' : 'All clear'}
            valueLabel={`${model.urgentCount}/${model.totalCount}`}
            size={104}
          />
          <p className="text-center text-[12px] font-semibold text-secondary">{model.headline}</p>
          {model.urgentLabels.length > 0 ? (
            <p className="text-center text-[11px] text-muted">Urgent: {model.urgentLabels.join(', ')}</p>
          ) : null}
        </div>
      )}
    </ExecutiveVisualizationShell>
  )
}
