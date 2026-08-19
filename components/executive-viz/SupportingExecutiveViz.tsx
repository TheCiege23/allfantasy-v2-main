'use client'

/**
 * Fantasy OS Suite — Phase V2.1: Commissioner OS supporting executive visualizations.
 *
 * Four supporting graphs that reinforce (never compete with) the flagship League Health Map. Each answers
 * exactly one commissioner decision and is built purely from the same normalized
 * `CommissionerLeagueHealthSnapshot` — no new intelligence, no history, no raw provider payloads, no
 * player-level records, no internal identifiers on the surface.
 *
 *   - ManagerAttentionCard    → "Where do my managers need attention?"
 *   - LeagueHealthBreakdownCard → "Which dimensions drive the overall score?"
 *   - CommissionerWorkloadCard → "What requires my action today?"
 *   - LeagueReadinessCard      → "Is the league operationally ready?"
 */
import { useMemo } from 'react'
import { Users, Layers, ListChecks, Gauge } from 'lucide-react'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import {
  buildManagerAttentionDistribution,
  buildLeagueHealthBreakdown,
  buildCommissionerWorkload,
  buildLeagueReadiness,
} from '@/lib/executive-viz/commissionerLeagueHealthViewModel'
import { ExecutiveHorizontalBars, ExecutiveProgressRing } from './ExecutiveCharts'
import {
  ExecutiveEmptyState,
  ExecutiveUnavailableState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

export function ManagerAttentionCard({ snapshot }: { snapshot: CommissionerLeagueHealthSnapshot | null }) {
  const model = useMemo(() => buildManagerAttentionDistribution(snapshot), [snapshot])
  return (
    <ExecutiveVisualizationShell
      title="Manager Attention"
      description="Where your managers need attention right now."
      icon={Users}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Manager activity appears once a league is connected and synced." />
      ) : (
        <>
          <p className="mb-3 text-[12px] font-semibold text-secondary">{model.headline}</p>
          <ExecutiveHorizontalBars items={model.items} />
        </>
      )}
    </ExecutiveVisualizationShell>
  )
}

export function LeagueHealthBreakdownCard({ snapshot }: { snapshot: CommissionerLeagueHealthSnapshot | null }) {
  const model = useMemo(() => buildLeagueHealthBreakdown(snapshot), [snapshot])
  return (
    <ExecutiveVisualizationShell
      title="Health Breakdown"
      description="Which dimensions drive the overall score."
      icon={Layers}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="The health breakdown appears once league health has been computed." />
      ) : (
        <>
          <p className="mb-3 text-[12px] font-semibold text-secondary">{model.headline}</p>
          <ExecutiveHorizontalBars items={model.items} />
        </>
      )}
    </ExecutiveVisualizationShell>
  )
}

export function CommissionerWorkloadCard({ snapshot }: { snapshot: CommissionerLeagueHealthSnapshot | null }) {
  const model = useMemo(() => buildCommissionerWorkload(snapshot), [snapshot])
  const total = model.items.reduce((sum, item) => sum + item.value, 0)
  return (
    <ExecutiveVisualizationShell
      title="Today's Workload"
      description="What requires your action today."
      icon={ListChecks}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Your workload appears once a league is connected and synced." />
      ) : total === 0 ? (
        <ExecutiveEmptyState
          icon={ListChecks}
          title="Nothing needs your action"
          description="No pending waivers, trades, alerts, or reviews are waiting on you right now."
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

export function LeagueReadinessCard({ snapshot }: { snapshot: CommissionerLeagueHealthSnapshot | null }) {
  const model = useMemo(() => buildLeagueReadiness(snapshot), [snapshot])
  return (
    <ExecutiveVisualizationShell
      title="League Readiness"
      description="Is the league operationally ready?"
      icon={Gauge}
      accessibleSummary={model.headline}
      footer={
        model.available && model.confidence ? (
          <span className="text-[10px] font-medium text-muted">Data confidence: {model.confidence}</span>
        ) : undefined
      }
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Readiness metrics appear once a league is connected and synced." />
      ) : (
        <>
          <p className="mb-3 text-[12px] font-semibold text-secondary">{model.headline}</p>
          <div className="flex flex-wrap items-start justify-around gap-4">
            {model.items.map((ring) => (
              <ExecutiveProgressRing
                key={ring.key}
                value={ring.value}
                status={ring.status}
                label={ring.label}
                valueLabel={ring.valueLabel}
              />
            ))}
          </div>
        </>
      )}
    </ExecutiveVisualizationShell>
  )
}
