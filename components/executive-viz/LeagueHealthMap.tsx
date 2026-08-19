'use client'

/**
 * Fantasy OS Suite — Phase V2.0: Commissioner OS signature visualization.
 *
 * The League Health Map — the recognizable flagship graph for Commissioner OS. It answers one question:
 *   "Which areas of this league need the commissioner's attention right now?"
 *
 * Structure: a ranked, segmented status map. Each row is one provider-agnostic health dimension
 * (overall health, manager activity, lineup readiness, competitive balance, engagement, unresolved
 * actions, sustainability, data readiness), drawn as a horizontal readiness bar colored by status and
 * ranked worst-first so attention items rise to the top. This is a CURRENT-SNAPSHOT view — there is no
 * legitimate per-dimension history in the data, so the map deliberately does not draw a time series or a
 * sparkline (see docs). It consumes a `CommissionerLeagueHealthViewModel`, never a raw provider payload,
 * and renders no player-level records or provider/API identifiers.
 */
import { useMemo } from 'react'
import { HeartPulse, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type {
  CommissionerHealthDimension,
  CommissionerLeagueHealthViewModel,
} from '@/lib/executive-viz/commissionerLeagueHealthViewModel'
import {
  EXECUTIVE_STATUS_BAR,
  EXECUTIVE_STATUS_DOT,
  EXECUTIVE_STATUS_LABEL,
  EXECUTIVE_STATUS_SURFACE,
} from './executiveVizTokens'
import {
  ExecutiveFreshnessStamp,
  ExecutiveLegend,
  ExecutiveLoadingState,
  ExecutiveUnavailableState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

function StatusChip({ status }: { status: CommissionerHealthDimension['status'] }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        EXECUTIVE_STATUS_SURFACE[status],
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', EXECUTIVE_STATUS_DOT[status])} aria-hidden />
      {EXECUTIVE_STATUS_LABEL[status]}
    </span>
  )
}

function DimensionRow({ dimension }: { dimension: CommissionerHealthDimension }) {
  const fill = dimension.score ?? 0
  const attention = dimension.status === 'at_risk' || dimension.status === 'critical'

  return (
    <li
      className="group rounded-xl border border-subtle bg-surface px-3 py-2.5 transition duration-200 hover:border-brand-primary/25 hover:bg-surface-hover motion-reduce:transition-none"
      data-testid={`league-health-dimension-${dimension.key}`}
      data-status={dimension.status}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] font-bold text-primary">{dimension.label}</p>
        <StatusChip status={dimension.status} />
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div
          className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"
          role="meter"
          aria-valuenow={Math.round(fill)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${dimension.label}: ${EXECUTIVE_STATUS_LABEL[dimension.status]}, ${dimension.valueLabel}`}
        >
          {/* Width is rendered directly at the correct value on first paint (never gated behind an
              effect/transition, which freeze in hidden/background tabs), so the bar is always visible.
              `transition-[width]` only eases any later value change and never hides the resting state. */}
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none',
              EXECUTIVE_STATUS_BAR[dimension.status],
            )}
            style={{ width: `${fill}%` }}
          />
        </div>
        <span className="shrink-0 text-[12px] font-semibold text-secondary">{dimension.valueLabel}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className={cn('min-w-0 text-[11px] leading-snug', attention ? 'text-secondary' : 'text-muted')}>
          {dimension.whyItMatters}
        </p>
        {dimension.actionHref && dimension.actionLabel ? (
          <Link
            href={dimension.actionHref}
            className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-brand-primary transition hover:bg-brand-primary/10"
          >
            {dimension.actionLabel}
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        ) : null}
      </div>
    </li>
  )
}

export function LeagueHealthMap({
  viewModel,
  loading = false,
  dominant = true,
}: {
  viewModel: CommissionerLeagueHealthViewModel | null
  loading?: boolean
  dominant?: boolean
}) {
  const dimensions = useMemo(() => viewModel?.dimensions ?? [], [viewModel])

  const meta = viewModel ? (
    <div className="flex flex-col items-end gap-1">
      <span className="text-[11px] font-medium text-secondary">{viewModel.contextLabel}</span>
      <ExecutiveFreshnessStamp updatedAt={viewModel.updatedAt} />
    </div>
  ) : null

  const footer = viewModel ? (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <ExecutiveLegend />
      <span className="text-[10px] font-medium text-muted">
        Current snapshot · {viewModel.dataConfidence} confidence
      </span>
    </div>
  ) : null

  return (
    <ExecutiveVisualizationShell
      title="League Health Map"
      description="Which areas of this league need your attention right now."
      icon={HeartPulse}
      dominant={dominant}
      meta={meta}
      footer={footer}
      accessibleSummary={
        viewModel
          ? viewModel.attention.headline
          : 'League health map is not available yet. Connect or sync a league to populate it.'
      }
    >
      {loading ? (
        <ExecutiveLoadingState rows={6} label="Loading league health map" />
      ) : !viewModel ? (
        <ExecutiveUnavailableState
          description="We don't have enough league data to map health yet. This appears once a league is connected and synced — no sample data is shown in its place."
          missing={['Connected league', 'Recent activity sync']}
        />
      ) : (
        <>
          <div
            className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]"
            data-testid="league-health-map-attention-summary"
          >
            <span className="font-semibold text-secondary">{viewModel.attention.headline}</span>
          </div>
          <ol className="space-y-2">
            {dimensions.map((dimension) => (
              <DimensionRow key={dimension.key} dimension={dimension} />
            ))}
          </ol>
        </>
      )}
    </ExecutiveVisualizationShell>
  )
}

export default LeagueHealthMap
