'use client'

import { useMemo, useState } from 'react'
import { Zap } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import { AutomationCatalogCard } from './AutomationCatalogCard'
import { StackedBarChart, DistributionBarChart, InfoCard } from '@/components/commissioner-os/cards'
import {
  automationRunOutcomes,
  automationStaleness,
  AUTOMATION_OUTCOME_SERIES,
} from '@/lib/commissioner-ui/charts/deriveChartSeries'
import { AutomationHistoryDialog } from './AutomationHistoryDialog'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type { AutomationCatalogEntry, AutomationExecutionEntry } from '@/lib/commissioner-ui/automations/decision-os-client'
import type { SeverityTier } from '@/lib/commissioner-ui/tokens/colors'

export interface AutomationCenterViewProps {
  catalog: AutomationCatalogEntry[]
  /** Fetched server-side for every catalog entry up front — this client component never fetches on its own, matching every other module's drawer/dialog in this program. */
  historyByAutomationId: Record<string, AutomationExecutionEntry[]>
  dataMode: CommissionerDataMode
  errorMessage?: string | null
}

const HEALTH_RANK: Record<SeverityTier, number> = { critical: 0, elevated: 1, standard: 2, advisory: 3, positive: 4 }

/**
 * Automation Center owns the catalog, status, schedules, execution
 * history/details, and health indicators. Enable/disable is a real,
 * locally-interactive toggle (unlike Workspace's rendered-but-unwired
 * next-action button) — Demo Mode is meant to look and behave
 * convincingly for screenshots/demos, and `PreviewDataBanner` already
 * carries the "not connected to live data" disclosure, so the toggle
 * doesn't need its own redundant caveat. It mutates local state only;
 * no Decision OS backend exists to persist it yet.
 */
export function AutomationCenterView({ catalog, historyByAutomationId, dataMode, errorMessage }: AutomationCenterViewProps) {
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(catalog.map((automation) => [automation.id, automation.status === 'enabled']))
  )
  const [historyAutomationId, setHistoryAutomationId] = useState<string | null>(null)

  const outcomeRows = useMemo(() => automationRunOutcomes(catalog), [catalog])
  const staleness = useMemo(() => automationStaleness(catalog), [catalog])

  const sortedCatalog = useMemo(
    () => catalog.slice().sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health]),
    [catalog]
  )

  const historyAutomation = catalog.find((automation) => automation.id === historyAutomationId) ?? null

  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

      {/*
        * Two charts, two different questions, and the second is the one this platform actually failed.
        * Outcomes answer "is it succeeding when it runs"; staleness answers "is it running at all".
        * `waivers.processLeague` scores perfectly on the first and had been silent for eleven weeks.
        */}
      {(outcomeRows.length > 0 || staleness.length > 0) ? (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {outcomeRows.length > 0 ? (
            <InfoCard title="Run outcomes">
              <StackedBarChart
                rows={outcomeRows}
                layout="horizontal"
                height={Math.max(160, outcomeRows.length * 44 + 60)}
                ariaLabel="Automation runs per job, split into succeeded, skipped and failed"
                series={[
                  { id: 'succeeded', label: 'Succeeded', color: 'var(--accent-emerald-strong)' },
                  { id: 'skipped', label: 'Skipped', color: 'var(--accent-amber-strong)' },
                  { id: 'failed', label: 'Failed', color: 'var(--accent-red-strong)' },
                ]}
              />
              {/*
                * The legend cannot carry this and the distinction decides how the whole chart reads.
                */}
              <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                A skip is the idempotency guard finding the window&apos;s work already done — not a
                failure. It is shown separately because a job that skips constantly is telling you
                something different from one that fails.
              </p>
            </InfoCard>
          ) : null}

          {staleness.length > 0 ? (
            <InfoCard title="Days since last run">
              <DistributionBarChart
                data={staleness}
                height={Math.max(160, staleness.length * 44 + 60)}
                valueLabel="Days"
                ariaLabel="Days since each automation last ran, most stale first"
              />
              <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                Judged on success rate alone a job that never runs looks perfect. This is the axis that
                shows it.
              </p>
            </InfoCard>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? (
        <ErrorState message={errorMessage} />
      ) : catalog.length === 0 ? (
        <EmptyState icon={Zap} title="No automations yet." description="Automations you create will appear here." />
      ) : (
        <div className="space-y-3">
          {sortedCatalog.map((automation) => (
            <AutomationCatalogCard
              key={automation.id}
              automation={automation}
              enabled={enabledMap[automation.id] ?? automation.status === 'enabled'}
              onToggle={(checked) => setEnabledMap((prev) => ({ ...prev, [automation.id]: checked }))}
              onViewHistory={() => setHistoryAutomationId(automation.id)}
            />
          ))}
        </div>
      )}

      <AutomationHistoryDialog
        automation={historyAutomation}
        history={historyAutomationId ? historyByAutomationId[historyAutomationId] ?? [] : []}
        onOpenChange={(open) => {
          if (!open) setHistoryAutomationId(null)
        }}
      />
    </div>
  )
}
