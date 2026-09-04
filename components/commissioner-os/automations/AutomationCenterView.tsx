'use client'

import { useMemo, useState } from 'react'
import { Zap } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/commissioner-os/states'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import { AutomationCatalogCard } from './AutomationCatalogCard'
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

  const sortedCatalog = useMemo(
    () => catalog.slice().sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health]),
    [catalog]
  )

  const historyAutomation = catalog.find((automation) => automation.id === historyAutomationId) ?? null

  return (
    <div>
      <PreviewDataBanner mode={dataMode} />

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
