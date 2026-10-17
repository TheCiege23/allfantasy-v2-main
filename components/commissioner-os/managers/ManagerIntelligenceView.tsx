'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { TrendIndicator } from '@/components/commissioner-os/primitives/TrendIndicator'
import { EmptyState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { ManagerDnaProfile } from '@/lib/commissioner-ui/managers/decision-os-client'
import { Users } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { cardsCopy, cosLoaderText, managerNameText } from '@/lib/commissioner-os/i18n/cardsCopy'

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
 *
 * Spanish: the screen's own labels through `cardsCopy`; `recognition` and `riskFlag` are sentences the
 * loader wrote, translated at render through `cosLoaderText`. Manager names stay as written.
 */
export function ManagerIntelligenceView({ managers, dataMode }: ManagerIntelligenceViewProps) {
  const { language } = useOptionalLanguage()
  const ui = (english: string) => cardsCopy(english, language)
  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {managers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={ui('No manager history yet.')}
          description={ui('Behavioral profiles build over time as the season progresses.')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {managers.map((manager) => (
            <Card key={manager.id}>
              <CardHeader>
                {/* A real name stays as written; only the loader's own placeholder for a missing one translates. */}
                <CardTitle>{managerNameText(manager.managerName, language)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* Tenure and trend are each rendered ONLY when real. An absent trend means the
                    manager has fewer than two behavioral snapshots, which is unknown — rendering a
                    flat indicator there would be indistinguishable from a measured 'steady'. */}
                {(manager.tenureSeasons !== undefined || manager.engagementTrend) && (
                  <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                    {manager.tenureSeasons !== undefined ? (
                      <span>{ui(`Tenure: ${manager.tenureSeasons} season${manager.tenureSeasons === 1 ? '' : 's'}`)}</span>
                    ) : (
                      <span />
                    )}
                    {manager.engagementTrend && (
                      <TrendIndicator
                        direction={TREND_DIRECTION[manager.engagementTrend]}
                        label={ui(TREND_LABEL[manager.engagementTrend])}
                      />
                    )}
                  </div>
                )}
                {/* The live backend classifies reliability as an ordinal level; demo/stub supply a
                    score. Prefer the real classification, fall back to the score, show neither
                    rather than a placeholder. */}
                {(manager.engagementReliability ?? manager.reliabilityScore) !== undefined && (
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>
                    {ui('Reliability:')}{' '}
                    {manager.engagementReliability
                      ? ui(RELIABILITY_LABEL[manager.engagementReliability])
                      : manager.reliabilityScore}
                  </div>
                )}
                {manager.recognition && (
                  <p className="text-xs" style={{ color: 'var(--severity-positive-text)' }}>
                    {cosLoaderText(manager.recognition, language)}
                  </p>
                )}
                {manager.riskFlag && (
                  <p className="text-xs" style={{ color: 'var(--severity-elevated-text)' }}>
                    {cosLoaderText(manager.riskFlag, language)}
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
