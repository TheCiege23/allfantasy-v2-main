'use client'

/**
 * Fantasy OS Suite — Phase V2.6: Draft OS supporting executive visualizations.
 *
 *   - DraftReadinessCard        → "How prepared am I for my next selection?"
 *   - DraftPreparationImpactCard → "Which preparation step has the greatest impact?"
 *
 * Both read the `draft_preparation` recommendations + `draftsApproachingCount` already carried by the
 * Manager Hub snapshot. Impact uses the engine's OWN priority ordinal — no draft-value/ADP score is
 * invented. Player-value / ADP / tier / positional-coverage / pick-pipeline visualizations are deferred
 * (no reachable contract — see EXECUTIVE_VISUALIZATION_ENGINE.md §Phase V2.6).
 */
import { useMemo } from 'react'
import { CalendarClock, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import {
  buildDraftReadiness,
  buildDraftPreparationImpact,
} from '@/lib/executive-viz/draftDecisionViewModel'
import { ExecutiveHorizontalBars } from './ExecutiveCharts'
import { EXECUTIVE_STATUS_SURFACE } from './executiveVizTokens'
import {
  ExecutiveEmptyState,
  ExecutiveUnavailableState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

export function DraftReadinessCard({
  snapshot,
  draftsApproachingCount,
}: {
  snapshot: ManagerCommandCenterSnapshot | null
  draftsApproachingCount: number
}) {
  const model = useMemo(() => buildDraftReadiness(snapshot, draftsApproachingCount), [snapshot, draftsApproachingCount])
  return (
    <ExecutiveVisualizationShell
      title="Draft Readiness"
      description="How prepared you are for your next selection."
      icon={CalendarClock}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Draft readiness appears once a league is connected and synced." />
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <div
            className={cn(
              'flex min-w-[6.5rem] flex-col items-center justify-center rounded-2xl border px-5 py-4 text-center',
              EXECUTIVE_STATUS_SURFACE[model.status],
            )}
          >
            <span className="text-[30px] font-black leading-none">{model.draftsApproaching}</span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">drafts approaching</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold text-primary">{model.readinessLabel}</p>
            <p className="mt-1 text-[12px] leading-snug text-secondary">{model.headline}</p>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-subtle bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-secondary">
              {model.prepItemsOpen} prep {model.prepItemsOpen === 1 ? 'step' : 'steps'} open
            </span>
          </div>
        </div>
      )}
    </ExecutiveVisualizationShell>
  )
}

export function DraftPreparationImpactCard({ snapshot }: { snapshot: ManagerCommandCenterSnapshot | null }) {
  const model = useMemo(() => buildDraftPreparationImpact(snapshot), [snapshot])
  return (
    <ExecutiveVisualizationShell
      title="Preparation Impact"
      description="Where the biggest draft-prep gains sit, by priority."
      icon={BarChart3}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Draft preparation appears once a league is connected and synced." />
      ) : model.items.length === 0 ? (
        <ExecutiveEmptyState
          icon={BarChart3}
          title="No preparation to weigh"
          description="No draft preparation recommendations are open across your teams right now."
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
