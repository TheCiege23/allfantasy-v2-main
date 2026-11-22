'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { EmptyState, ErrorState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import { ManagerRecordView } from '@/components/core-app/manager-record/ManagerRecordSheet'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { ManagerDirectoryEntry } from '@/lib/commissioner-ui/managers/decision-os-client/types'
import type { ManagerRecord } from '@/lib/competitive-edge/managerRecord'
import { Users } from 'lucide-react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { cardsCopy, managerNameText } from '@/lib/commissioner-os/i18n/cardsCopy'
import { cosErrorText } from '@/lib/commissioner-os/i18n/analyticsCopy'

interface ManagerIntelligenceViewProps {
  managers: ManagerDirectoryEntry[]
  dataMode: CommissionerDataMode
  /** The adapter's error. A failed read is never drawn as an empty league. */
  errorMessage?: string | null
}

/**
 * The commissioner's Managers screen — every manager's record as FACTS (2026-11-16, re-score item 11):
 * trades by position, waiver claims and FAAB this season, past drafts. The record Chimmy and the manager
 * card read, so the three never disagree.
 *
 * 🛑 NO PROFILE, NO SCORE, NO PREDICTION. This screen once showed archetypes and a reliability score
 * from the Manager DNA classifier, retired in Milestone 32. Every line now is a count a commissioner
 * can check, and the facts are drawn by the same component the manager card uses.
 */
export function summaryLine(r: ManagerRecord, language: string): string {
  const es = language === 'es'
  const parts: string[] = []
  if (r.trades.available) {
    const n = r.trades.data.coverage.trades
    parts.push(es ? `${n} ${n === 1 ? 'intercambio' : 'intercambios'}` : `${n} ${n === 1 ? 'trade' : 'trades'}`)
  }
  if (r.waivers.available) {
    const n = r.waivers.data.claims
    parts.push(es ? `${n} ${n === 1 ? 'reclamo ganado' : 'reclamos ganados'} esta temporada` : `${n} waiver ${n === 1 ? 'claim' : 'claims'} won this season`)
    const faab = r.waivers.data.faabRemaining
    if (faab != null) parts.push(es ? `$${faab} de FAAB` : `$${faab} FAAB left`)
  }
  if (r.drafts.available) {
    const n = r.drafts.data.drafts
    parts.push(es ? `${n} ${n === 1 ? 'draft' : 'drafts'} registrados` : `${n} ${n === 1 ? 'draft' : 'drafts'} on file`)
  }
  return parts.join(' · ')
}

export function ManagerIntelligenceView({ managers, dataMode, errorMessage }: ManagerIntelligenceViewProps) {
  const { language } = useOptionalLanguage()
  const ui = (english: string) => cardsCopy(english, language)
  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {errorMessage ? (
        <ErrorState message={cosErrorText(errorMessage, language)} />
      ) : managers.length === 0 ? (
        <EmptyState icon={Users} title={ui('No managers in this league yet.')} description={ui('Each manager’s record appears here once their team is imported.')} />
      ) : (
        <>
          <p className="mb-3 text-xs" style={{ color: 'var(--muted)' }}>
            {ui('What each manager has done, as counts you can check — never a label, never a prediction.')}
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {managers.map((m) => {
              const summary = summaryLine(m.record, language)
              return (
                <Card key={m.id} data-testid="cos-manager-record">
                  <CardHeader>
                    {/* A real name stays as written; only the loader's own placeholder for a missing one translates. */}
                    <CardTitle>{managerNameText(m.managerName, language)}</CardTitle>
                    {summary ? (
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>
                        {summary}
                      </p>
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    <details>
                      <summary className="cursor-pointer text-sm">{ui('Full record')}</summary>
                      <ManagerRecordView record={m.record} language={language} />
                    </details>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
