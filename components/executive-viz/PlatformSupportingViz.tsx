'use client'

/**
 * Fantasy OS Suite — Phase V2.7: Platform OS supporting executive visualizations.
 *
 *   - ExecutiveWorkloadCard → "How much work is waiting, and how urgent?"
 *   - AttentionSummaryCard  → "What is flagged across my footprint?"
 *
 * Both read the cross-league `ManagerCommandCenterSnapshot` (recommendations by priority; attention
 * signals by severity). They summarize the footprint — no player-level data, no provider identifiers, no
 * fabricated platform trends/KPIs. Platform history/momentum/adoption analytics are deferred (no reachable
 * contract — see EXECUTIVE_VISUALIZATION_ENGINE.md §Phase V2.7).
 */
import { useMemo } from 'react'
import { Gauge, Bell } from 'lucide-react'
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import {
  buildExecutiveWorkload,
  buildAttentionSummary,
} from '@/lib/executive-viz/platformFocusViewModel'
import { ExecutiveHorizontalBars } from './ExecutiveCharts'
import {
  ExecutiveEmptyState,
  ExecutiveUnavailableState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

export function ExecutiveWorkloadCard({ snapshot }: { snapshot: ManagerCommandCenterSnapshot | null }) {
  const model = useMemo(() => buildExecutiveWorkload(snapshot), [snapshot])
  return (
    <ExecutiveVisualizationShell
      title="Executive Workload"
      description="How much work is waiting, by priority."
      icon={Gauge}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Your workload appears once a league is connected and synced." />
      ) : model.items.length === 0 ? (
        <ExecutiveEmptyState
          icon={Gauge}
          title="No open decisions"
          description="Nothing is waiting on you across your footprint right now."
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

export function AttentionSummaryCard({ snapshot }: { snapshot: ManagerCommandCenterSnapshot | null }) {
  const model = useMemo(() => buildAttentionSummary(snapshot), [snapshot])
  return (
    <ExecutiveVisualizationShell
      title="Attention Summary"
      description="What is flagged across your footprint, by severity."
      icon={Bell}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Attention signals appear once a league is connected and synced." />
      ) : model.items.length === 0 ? (
        <ExecutiveEmptyState
          icon={Bell}
          title="Nothing flagged"
          description="No attention signals are open across your footprint right now."
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
