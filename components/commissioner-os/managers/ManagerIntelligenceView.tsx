'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendIndicator } from '@/components/commissioner-os/primitives/TrendIndicator'
import { EmptyState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { ManagerDnaProfile } from '@/lib/commissioner-ui/managers/decision-os-client'
import { Users } from 'lucide-react'

export interface ManagerIntelligenceViewProps {
  managers: ManagerDnaProfile[]
  dataMode: CommissionerDataMode
}

const TREND_LABEL = { rising: 'Rising', steady: 'Steady', declining: 'Declining' } as const
const TREND_DIRECTION = { rising: 'up', steady: 'flat', declining: 'down' } as const
const RELIABILITY_LABEL = {
  reliable: 'Consistent',
  inconsistent: 'Some gaps',
  unreliable: 'Major gaps',
} as const

/**
 * Manager Intelligence owns behavioral pattern analysis only — this
 * component renders it, never computes it. No overall score is ever
 * shown (Privacy & Trust: no single collapsed "manager score"); every
 * profile shows Recognition and Risk with equal structural weight, never
 * one without the other where both apply.
 */
export function ManagerIntelligenceView({ managers, dataMode }: ManagerIntelligenceViewProps) {
  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {managers.length === 0 ? (
        <EmptyState icon={Users} title="No manager history yet." description="Behavioral profiles build over time as the season progresses." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {managers.map((manager) => (
            <Card key={manager.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{manager.managerName}</CardTitle>
                  <Badge variant="secondary">{manager.archetype}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* Tenure and trend are each rendered ONLY when real. An absent trend means the
                    manager has fewer than two behavioral snapshots, which is unknown — rendering a
                    flat indicator there would be indistinguishable from a measured 'steady'. */}
                {(manager.tenureSeasons !== undefined || manager.engagementTrend) && (
                  <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                    {manager.tenureSeasons !== undefined ? (
                      <span>Tenure: {manager.tenureSeasons} season{manager.tenureSeasons === 1 ? '' : 's'}</span>
                    ) : (
                      <span />
                    )}
                    {manager.engagementTrend && (
                      <TrendIndicator
                        direction={TREND_DIRECTION[manager.engagementTrend]}
                        label={TREND_LABEL[manager.engagementTrend]}
                      />
                    )}
                  </div>
                )}
                {/* The live backend classifies reliability as an ordinal level; demo/stub supply a
                    score. Prefer the real classification, fall back to the score, show neither
                    rather than a placeholder. */}
                {(manager.engagementReliability ?? manager.reliabilityScore) !== undefined && (
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>
                    Reliability: {manager.engagementReliability
                      ? RELIABILITY_LABEL[manager.engagementReliability]
                      : manager.reliabilityScore}
                  </div>
                )}
                {manager.recognition && (
                  <p className="text-xs" style={{ color: 'var(--severity-positive-text)' }}>
                    {manager.recognition}
                  </p>
                )}
                {manager.riskFlag && (
                  <p className="text-xs" style={{ color: 'var(--severity-elevated-text)' }}>
                    {manager.riskFlag}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
