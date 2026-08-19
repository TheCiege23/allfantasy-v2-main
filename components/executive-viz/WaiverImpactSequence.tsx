'use client'

/**
 * Fantasy OS Suite — Phase V2.5: Waiver OS signature visualization.
 *
 * Waiver Impact Sequence — the flagship for Waiver OS (the fifth Executive Analytics Workspace). It
 * answers: "Which waiver actions could improve my team, and what should I do first?"
 *
 * It is an ORDERED SEQUENCE, not a timeline. Per the Step 1 audit, no legitimate temporal waiver data
 * (deadlines, processing windows, pickup history) is reachable from any customer-facing route, so this
 * deliberately expresses action ORDER + urgency using the engine's existing recommendation priority — it
 * never implies calendar chronology and never invents opportunity-expiration.
 *
 * The primary subject is the DECISION: opportunity → expected impact → why it matters → required action.
 * No raw provider waiver statuses, ownership fields, payloads, or internal identifiers are rendered.
 */
import { useMemo } from 'react'
import { Layers, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import { buildWaiverImpactSequence } from '@/lib/executive-viz/waiverDecisionViewModel'
import { ExecutiveDecisionSequence, type ExecutiveSequenceItem } from './ExecutiveCharts'
import { EXECUTIVE_STATUS_SURFACE } from './executiveVizTokens'
import {
  ExecutiveEmptyState,
  ExecutiveUnavailableState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

export function WaiverImpactSequence({
  snapshot,
  loading = false,
}: {
  snapshot: ManagerCommandCenterSnapshot | null
  loading?: boolean
}) {
  const model = useMemo(() => buildWaiverImpactSequence(snapshot), [snapshot])

  const items: ExecutiveSequenceItem[] = useMemo(
    () =>
      model.opportunities.map((o) => ({
        key: o.key,
        label: o.label,
        detail: o.detail,
        badgeLabel: o.priorityLabel,
        status: o.status,
        meta: o.confidenceLabel,
      })),
    [model],
  )

  return (
    <ExecutiveVisualizationShell
      title="Waiver Impact Sequence"
      description="Which waiver actions could improve your team — and what to do first."
      icon={Layers}
      dominant
      meta={
        model.available && model.totalCount > 0 ? (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
              model.urgentCount > 0 ? EXECUTIVE_STATUS_SURFACE.at_risk : EXECUTIVE_STATUS_SURFACE.healthy,
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {model.urgentCount} urgent
          </span>
        ) : undefined
      }
      accessibleSummary={model.headline}
    >
      {loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-surface-muted motion-reduce:animate-none" role="status" aria-label="Loading waiver opportunities" />
      ) : !model.available ? (
        <ExecutiveUnavailableState
          description="Waiver opportunities appear once you belong to at least one connected, synced league — no sample opportunities are shown in their place."
          missing={['A connected league', 'Recent activity']}
        />
      ) : model.opportunities.length === 0 ? (
        <ExecutiveEmptyState
          icon={Layers}
          title="Nothing worth claiming right now"
          description={model.headline + ' This fills as waiver opportunities are generated for your teams.'}
        />
      ) : (
        <>
          <p className="mb-3 text-[12px] font-semibold text-secondary">{model.headline}</p>
          <ExecutiveDecisionSequence items={items} testIdPrefix="waiver-step" />
          <p className="mt-3 text-[10px] font-medium text-muted">
            Ordered by priority, not by date — no waiver deadlines or processing windows are available.
          </p>
        </>
      )}
    </ExecutiveVisualizationShell>
  )
}

export default WaiverImpactSequence
