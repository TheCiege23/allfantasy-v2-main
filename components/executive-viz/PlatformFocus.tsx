'use client'

/**
 * Fantasy OS Suite — Phase V2.7: Platform OS signature visualization.
 *
 * Platform Focus — the flagship for Platform OS, the executive layer ABOVE the individual Operating
 * Systems. It answers: "What requires my attention across my entire Fantasy OS footprint?"
 *
 * It SUMMARIZES the other workspaces (open work per Operating System, ranked by urgency) — it does not
 * duplicate them. Per the Step 1 audit, no platform-level history/trend/momentum series is reachable, so
 * this is a truthful current-state focus view, NOT a fabricated "Platform Pulse". It consumes the
 * cross-league `ManagerCommandCenterSnapshot`; no raw provider payloads, player-level records, or provider
 * identifiers are rendered.
 */
import { useMemo } from 'react'
import { LayoutGrid, Trophy, AlertCircle, ListChecks, CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import { buildPlatformFocus, platformFocusBars } from '@/lib/executive-viz/platformFocusViewModel'
import { ExecutiveHorizontalBars } from './ExecutiveCharts'
import { decisionOsToneClasses } from '@/components/decision-os/DecisionOsCardPrimitives'
import {
  ExecutiveEmptyState,
  ExecutiveUnavailableState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

function FootprintKpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  tone: 'neutral' | 'good' | 'warning' | 'danger'
}) {
  return (
    <div className={cn('flex min-h-[76px] flex-col justify-between rounded-2xl border p-3', decisionOsToneClasses(tone))}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
        <Icon className="h-3.5 w-3.5 text-current opacity-70" aria-hidden />
      </div>
      <span className="mt-1 text-[24px] font-black leading-none text-current">{value}</span>
    </div>
  )
}

export function PlatformFocus({
  snapshot,
  draftsApproachingCount,
  loading = false,
  scopeLabel = 'across every league you manage',
}: {
  snapshot: ManagerCommandCenterSnapshot | null
  draftsApproachingCount: number
  loading?: boolean
  /**
   * Brand-neutral phrase describing the cross-league scope, e.g. "across every league you manage".
   * White-label (Phase V5.0): supplied by the hosting hub from the active tenant so this — the one
   * string that renders inside the executive-viz layer — stays free of any product/provider name.
   */
  scopeLabel?: string
}) {
  const model = useMemo(() => buildPlatformFocus(snapshot, draftsApproachingCount), [snapshot, draftsApproachingCount])
  const bars = useMemo(() => platformFocusBars(model), [model])

  return (
    <ExecutiveVisualizationShell
      title="Platform Focus"
      description={`Where to focus first ${scopeLabel}.`}
      icon={LayoutGrid}
      dominant
      accessibleSummary={model.headline}
    >
      {loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-surface-muted motion-reduce:animate-none" role="status" aria-label="Loading your platform overview" />
      ) : !model.available ? (
        <ExecutiveUnavailableState
          description="Your platform overview appears once you belong to at least one connected, synced league — no sample data is shown in its place."
          missing={['A connected league', 'Recent activity']}
        />
      ) : (
        <>
          <p className="mb-3 text-[13px] font-bold leading-snug text-primary">{model.headline}</p>

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FootprintKpi icon={Trophy} label="Leagues" value={model.totalLeagues} tone="neutral" />
            <FootprintKpi
              icon={AlertCircle}
              label="Need attention"
              value={model.leaguesNeedingAttention}
              tone={model.leaguesNeedingAttention > 0 ? 'danger' : 'good'}
            />
            <FootprintKpi
              icon={ListChecks}
              label="Open decisions"
              value={model.totalOpenDecisions}
              tone={model.totalOpenDecisions > 5 ? 'warning' : model.totalOpenDecisions > 0 ? 'neutral' : 'good'}
            />
            <FootprintKpi
              icon={CalendarClock}
              label="Drafts soon"
              value={model.draftsApproaching}
              tone={model.draftsApproaching > 0 ? 'warning' : 'good'}
            />
          </div>

          {model.areas.length > 0 ? (
            <>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">Where the work is</p>
              <ExecutiveHorizontalBars items={bars} />
            </>
          ) : (
            <ExecutiveEmptyState
              icon={LayoutGrid}
              title="Nothing needs action across your footprint"
              description="No lineup, waiver, trade, draft, or engagement decisions are open across your leagues right now."
            />
          )}
        </>
      )}
    </ExecutiveVisualizationShell>
  )
}

export default PlatformFocus
