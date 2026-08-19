'use client'

/**
 * Fantasy OS Suite — Phase V2.3: League OS signature visualization.
 *
 * League Momentum — the recognizable flagship for League OS, the third Executive Analytics Workspace
 * (after Commissioner OS's League Health Map and Manager OS's Championship Trajectory). It answers:
 * "How is the competitive landscape changing?"
 *
 * `LeagueActivityTrendSummary` carries legitimate multi-period history, so this uses REAL momentum
 * (direction + event-count delta over tracked periods) when it exists, and degrades to an honest
 * current-state snapshot otherwise — never a fabricated trend. It speaks about the LEAGUE, not any one
 * manager/player, and exposes no provider payloads or identifiers.
 */
import { useMemo } from 'react'
import { Activity, TrendingUp, TrendingDown, Minus, Users, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import {
  buildLeagueMomentum,
  leagueMomentumLabel,
  type LeagueMomentumViewModel,
} from '@/lib/executive-viz/leagueMomentumViewModel'
import { EXECUTIVE_STATUS_SURFACE } from './executiveVizTokens'
import {
  ExecutiveFreshnessStamp,
  ExecutiveUnavailableState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

function MomentumHero({ model }: { model: LeagueMomentumViewModel }) {
  const Icon =
    model.direction === 'increasing' ? TrendingUp : model.direction === 'decreasing' ? TrendingDown : model.hasHistory ? Minus : Activity
  const bigValue = model.hasHistory
    ? `${(model.eventCountDelta ?? 0) >= 0 ? '+' : ''}${model.eventCountDelta}`
    : `${model.totalActivity}`
  const caption = model.hasHistory ? `moves over ${model.periodsTracked} periods` : 'recent moves'
  return (
    <div
      className={cn(
        'flex min-w-[7rem] flex-col items-center justify-center rounded-2xl border px-5 py-4 text-center',
        EXECUTIVE_STATUS_SURFACE[model.tone],
      )}
    >
      <Icon className="h-6 w-6" aria-hidden />
      <span className="mt-1 text-[30px] font-black leading-none">{bigValue}</span>
      <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">{caption}</span>
    </div>
  )
}

export function LeagueMomentum({
  snapshot,
  loading = false,
}: {
  snapshot: LeagueAnalyticsSnapshot | null
  loading?: boolean
}) {
  const model = useMemo(() => buildLeagueMomentum(snapshot), [snapshot])

  return (
    <ExecutiveVisualizationShell
      title="League Momentum"
      description="How the competitive landscape is changing."
      icon={Activity}
      dominant
      meta={model?.available ? <ExecutiveFreshnessStamp updatedAt={model.updatedAt} /> : undefined}
      accessibleSummary={
        model?.available ? model.headline : 'League momentum is not available yet. This league needs more activity to summarize.'
      }
    >
      {loading ? (
        <div className="h-36 animate-pulse rounded-xl bg-surface-muted motion-reduce:animate-none" role="status" aria-label="Loading league momentum" />
      ) : !model || !model.available ? (
        <ExecutiveUnavailableState
          description="League momentum appears once this league has enough recorded activity — no sample trend is shown in its place."
          missing={['Recorded league activity']}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-[auto,1fr] sm:items-center">
          <div className="flex items-center justify-center">
            <MomentumHero model={model} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
                  EXECUTIVE_STATUS_SURFACE[model.tone],
                )}
              >
                {leagueMomentumLabel(model.status)}
              </span>
              {!model.hasHistory ? (
                <span className="text-[11px] font-medium text-muted" title="Not enough history yet to show a trend.">
                  Current snapshot
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-[15px] font-bold leading-snug text-primary">{model.headline}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-subtle bg-surface-muted px-2.5 py-1 font-semibold text-secondary">
                <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {model.hasHistory ? `${model.latestEventCount} moves last period` : `${model.totalActivity} moves recorded`}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-subtle bg-surface-muted px-2.5 py-1 font-semibold text-secondary">
                <Users className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {model.activeManagers} active managers
              </span>
            </div>
          </div>
        </div>
      )}
    </ExecutiveVisualizationShell>
  )
}

export default LeagueMomentum
