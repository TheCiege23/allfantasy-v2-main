'use client'

/**
 * Fantasy OS Suite — Phase V2.6: Draft OS signature visualization.
 *
 * Draft Decision Ladder — the flagship for Draft OS (the sixth Executive Analytics Workspace). It
 * answers: "How should I understand my draft position and upcoming draft decisions?"
 *
 * It is an ORDERED LADDER, not a "Draft Value Curve" and not a pick timeline. Per the Step 1 audit, no
 * provider-agnostic value series, ADP, tier, or pick/timing data is reachable from any customer-facing
 * route, so this deliberately expresses decision ORDER + priority using the engine's existing
 * `draft_preparation` recommendation priority — it never draws a value curve, implies pick chronology, or
 * invents projected availability.
 *
 * Decision-first: preparation step → expected impact → why it matters → required action. No player-level
 * records, provider payloads, ADP fields, or internal identifiers are rendered.
 */
import { useMemo } from 'react'
import { ListChecks, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import { buildDraftDecisionLadder } from '@/lib/executive-viz/draftDecisionViewModel'
import { ExecutiveDecisionSequence, type ExecutiveSequenceItem } from './ExecutiveCharts'
import { EXECUTIVE_STATUS_SURFACE } from './executiveVizTokens'
import {
  ExecutiveEmptyState,
  ExecutiveUnavailableState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

export function DraftDecisionLadder({
  snapshot,
  loading = false,
}: {
  snapshot: ManagerCommandCenterSnapshot | null
  loading?: boolean
}) {
  const model = useMemo(() => buildDraftDecisionLadder(snapshot), [snapshot])

  const items: ExecutiveSequenceItem[] = useMemo(
    () =>
      model.decisions.map((d) => ({
        key: d.key,
        label: d.label,
        detail: d.detail,
        badgeLabel: d.priorityLabel,
        status: d.status,
        meta: d.confidenceLabel,
      })),
    [model],
  )

  return (
    <ExecutiveVisualizationShell
      title="Draft Decision Ladder"
      description="How to read your draft position — what to prepare, in priority order."
      icon={ListChecks}
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
        <div className="h-40 animate-pulse rounded-xl bg-surface-muted motion-reduce:animate-none" role="status" aria-label="Loading draft preparation" />
      ) : !model.available ? (
        <ExecutiveUnavailableState
          description="Draft preparation appears once you belong to at least one connected, synced league — no sample steps are shown in their place."
          missing={['A connected league', 'A recommendation model with enough evidence']}
        />
      ) : model.decisions.length === 0 ? (
        <ExecutiveEmptyState
          icon={ListChecks}
          title="Nothing to prepare right now"
          description={model.headline + ' This fills as draft preparation steps are generated for your teams.'}
        />
      ) : (
        <>
          <p className="mb-3 text-[12px] font-semibold text-secondary">{model.headline}</p>
          <ExecutiveDecisionSequence items={items} testIdPrefix="draft-step" />
          <p className="mt-3 text-[10px] font-medium text-muted">
            Ordered by priority, not by draft value or pick number — no draft board, player values, or pick timing is available.
          </p>
        </>
      )}
    </ExecutiveVisualizationShell>
  )
}

export default DraftDecisionLadder
