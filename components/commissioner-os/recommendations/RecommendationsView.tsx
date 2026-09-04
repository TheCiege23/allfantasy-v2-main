'use client'

import { useMemo, useState } from 'react'
import { RecommendationCard } from '@/components/commissioner-os/cards'
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
      .filter((rec) => statuses.includes(rec.status))
      .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])
  }, [recommendations, showArchive])

  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

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
