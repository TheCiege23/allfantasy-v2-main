'use client'

import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react'
import type { LeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import type { LeagueActivityTrendSummary } from '@/lib/decision-os/dashboard-intelligence'
import {
  DecisionOsBadge,
  DecisionOsEmptyState,
  DecisionOsInsufficientDataCallout,
  DecisionOsPanel,
  DecisionOsUpdatedStamp,
  decisionOsCardClassName,
} from './DecisionOsCardPrimitives'

type LeagueAnalyticsCardProps = {
  snapshot: LeagueAnalyticsSnapshot | null
  variant?: 'dashboard' | 'league' | 'commissioner'
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl border border-subtle bg-surface-muted px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1 text-lg font-black text-primary">{value}</p>
    </div>
  )
}

function TrendPanel({ trend }: { trend: LeagueActivityTrendSummary }) {
  if (!trend.available) {
    const message =
      trend.reason === 'no_snapshots'
        ? 'No activity snapshots have been captured yet for this league.'
        : 'Only one snapshot captured so far — trend needs at least two to compare.'
    return (
      <DecisionOsPanel title="Activity over time">
        <p className="mt-2 text-sm leading-6 text-muted" data-testid="league-analytics-trend-unavailable">
          {trend.reason === 'no_snapshots' ? 'no_snapshots' : 'insufficient_history'} — {message}
        </p>
      </DecisionOsPanel>
    )
  }
  const Icon = trend.direction === 'increasing' ? ArrowUp : trend.direction === 'decreasing' ? ArrowDown : ArrowRight
  return (
    <DecisionOsPanel title="Activity over time">
      <div className="mt-2 flex items-center gap-2" data-testid="league-analytics-trend-available">
        <Icon className="h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
        <p className="text-sm font-bold text-primary">
          {trend.direction} ({trend.eventCountDelta > 0 ? '+' : ''}
          {trend.eventCountDelta} events)
        </p>
      </div>
      <p className="mt-1 text-xs leading-5 text-secondary">
        {trend.periodsTracked} periods tracked, {trend.earliestPeriodKey} to {trend.latestPeriodKey}
      </p>
    </DecisionOsPanel>
  )
}

/**
 * League Analytics — a sibling surface to Mission Control, answering "what is happening in this
 * league over time?" (activity counts, manager counts, activity trend, a bare retention-risk
 * count). Deliberately no named at-risk managers and no recommended actions — those belong to
 * Mission Control's "what should the commissioner do now?" framing, not this one.
 */
export default function LeagueAnalyticsCard({ snapshot, variant = 'commissioner' }: LeagueAnalyticsCardProps) {
  if (!snapshot) {
    return (
      <section data-testid={`league-analytics-card-${variant}`} className={decisionOsCardClassName}>
        <div className="p-5">
          <DecisionOsEmptyState
            title="League Analytics is loading"
            description="Real activity trend and counts will appear here once loaded."
          />
        </div>
      </section>
    )
  }

  if (!snapshot.available) {
    return (
      <section data-testid={`league-analytics-card-${variant}`} className={decisionOsCardClassName} aria-label="League Analytics">
        <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <DecisionOsBadge>League Analytics</DecisionOsBadge>
            <DecisionOsUpdatedStamp value={snapshot.generatedAt} includeTime />
          </div>
        </div>
        <div className="p-5">
          <div data-testid="league-analytics-unavailable">
            <DecisionOsInsufficientDataCallout
              title="League Analytics unavailable"
              message="This league's activity data couldn't be loaded right now."
              missing={['league health']}
            />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      data-testid={`league-analytics-card-${variant}`}
      className={decisionOsCardClassName}
      aria-label="League Analytics"
    >
      <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionOsBadge>League Analytics</DecisionOsBadge>
          <DecisionOsUpdatedStamp value={snapshot.generatedAt} includeTime />
        </div>
        <h2 className="mt-3 text-xl font-black tracking-tight text-primary">
          What&apos;s happening in this league over time
        </h2>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatChip label="Active managers" value={snapshot.managerCounts.activeManagers} />
            <StatChip label="Inactive managers" value={snapshot.managerCounts.inactiveManagers} />
            <StatChip label="Trades" value={snapshot.activity.tradeCount} />
            <StatChip label="Waiver claims" value={snapshot.activity.waiverClaimCount} />
            <StatChip label="Draft picks" value={snapshot.activity.draftPickCount} />
            <StatChip label="Roster activity" value={snapshot.activity.rosterActivityCount} />
          </div>

          <TrendPanel trend={snapshot.trend} />
        </div>

        <aside className="space-y-4">
          <DecisionOsPanel title="Managers at retention risk" className="bg-surface-muted">
            <p className="mt-2 text-2xl font-black text-primary" data-testid="league-analytics-retention-risk-count">
              {snapshot.retentionRiskCount}
            </p>
            <p className="mt-1 text-xs leading-5 text-secondary">
              {snapshot.retentionRiskCount === 0
                ? 'No managers currently flagged'
                : 'See Mission Control for names and specific reasons.'}
            </p>
          </DecisionOsPanel>
        </aside>
      </div>
    </section>
  )
}
