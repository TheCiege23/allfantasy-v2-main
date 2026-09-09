'use client'

import { useMemo, useState } from 'react'
import { RecommendationCard, ActivityMixDonut, InfoCard } from '@/components/commissioner-os/cards'
import { recommendationsBySeverity } from '@/lib/commissioner-ui/charts/deriveChartSeries'
import { EmptyState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { CommissionerRecommendationContract, CommissionerRecommendationStatus } from '@/lib/commissioner-ui/contracts'
import { Lightbulb } from 'lucide-react'

export interface RecommendationsViewProps {
  recommendations: CommissionerRecommendationContract[]
  dataMode: CommissionerDataMode
}

const LIVE_STATUSES: CommissionerRecommendationStatus[] = ['new', 'viewed', 'in_progress', 'deferred', 'automated']
const TERMINAL_STATUSES: CommissionerRecommendationStatus[] = ['completed', 'dismissed', 'expired', 'resolved']

/**
 * Recommendations Center owns the recommendation lifecycle — priority,
 * evidence, confidence, status, actions. Default view is flat, sorted by
 * severity, never grouped by category (Recommendations Center §20) —
 * urgency always wins over categorical organization.
 */
export function RecommendationsView({ recommendations, dataMode }: RecommendationsViewProps) {
  const [showArchive, setShowArchive] = useState(false)

  const severityRank = { critical: 0, elevated: 1, standard: 2, advisory: 3, positive: 4 } as const

  const visible = useMemo(() => {
    const statuses = showArchive ? TERMINAL_STATUSES : LIVE_STATUSES
    return recommendations
      .filter((rec) => {
        /*
         * 🛑 A RECOMMENDATION WITH NO STATUS BELONGS IN THE QUEUE, NOT NOWHERE. `status` became
         * optional when the live client stopped discarding real recommendations — nothing
         * persists a lifecycle, so every live recommendation arrives without one. The previous
         * `statuses.includes(rec.status)` returned false for `undefined`, which would have
         * filtered out EVERY real recommendation: the module would have wired correctly, fetched
         * correctly, mapped correctly, and still rendered an empty queue.
         *
         * Statusless means "not yet triaged", which is the definition of the live queue and the
         * opposite of archived — so it shows in Queue and is absent from Archive.
         */
        if (rec.status === undefined) return !showArchive
        return statuses.includes(rec.status)
      })
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
  }, [recommendations, showArchive])

  const severityMix = useMemo(() => recommendationsBySeverity(visible), [visible])

  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {/*
        * Severity mix of whatever the current filter is showing — derived from `visible`, not from the
        * whole queue, so the chart always describes the list underneath it. A donut that ignored the
        * archive toggle would contradict the rows beside it.
        */}
      {severityMix.length > 0 ? (
        <div className="mb-6">
          <InfoCard title="Open queue by severity">
            <ActivityMixDonut
              slices={severityMix}
              height={220}
              ariaLabel={`${visible.length} recommendation${visible.length === 1 ? '' : 's'} by severity`}
            />
          </InfoCard>
        </div>
      ) : null}

      <div className="mb-4 flex gap-2" role="tablist" aria-label="Recommendation view">
        <button
          type="button"
          role="tab"
          aria-selected={!showArchive}
          onClick={() => setShowArchive(false)}
          className="focus-ring rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
          style={{
            background: !showArchive ? 'var(--panel2)' : 'transparent',
            color: !showArchive ? 'var(--text)' : 'var(--muted)',
            border: '1px solid var(--border)',
          }}
        >
          Queue
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showArchive}
          onClick={() => setShowArchive(true)}
          className="focus-ring rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
          style={{
            background: showArchive ? 'var(--panel2)' : 'transparent',
            color: showArchive ? 'var(--text)' : 'var(--muted)',
            border: '1px solid var(--border)',
          }}
        >
          History
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title={showArchive ? 'Nothing archived recently.' : "You're all caught up."}
          description={showArchive ? '' : 'No open recommendations.'}
        />
      ) : (
        <div className="space-y-3">
          {visible.map((rec) => (
            <RecommendationCard
              key={rec.id}
              title={rec.title}
              rationale={rec.rationale}
              severity={rec.severity}
              confidence={rec.confidence}
              expectedImpact={rec.expectedImpact}
              primaryActionLabel={rec.primaryActionLabel}
              status={rec.status}
            />
          ))}
        </div>
      )}
    </div>
  )
}
