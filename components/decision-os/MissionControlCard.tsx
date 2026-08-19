'use client'

import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, ShieldAlert } from 'lucide-react'
import type { MissionControlSnapshot } from '@/lib/decision-os/missionControl'
import {
  DecisionOsBadge,
  DecisionOsEmptyState,
  DecisionOsInsufficientDataCallout,
  DecisionOsPanel,
  DecisionOsUpdatedStamp,
  decisionOsCardClassName,
  decisionOsHealthStatusToneClasses,
  decisionOsToneClasses,
} from './DecisionOsCardPrimitives'

type MissionControlCardProps = {
  snapshot: MissionControlSnapshot | null
  variant?: 'dashboard' | 'league' | 'commissioner'
  compact?: boolean
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl border border-subtle bg-surface-muted px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1 text-lg font-black text-primary">{value}</p>
    </div>
  )
}

function TrendPanel({ trend }: { trend: MissionControlSnapshot['trend'] }) {
  if (!trend.available) {
    const message =
      trend.reason === 'no_snapshots'
        ? 'No activity snapshots have been captured yet for this league.'
        : 'Only one snapshot captured so far — trend needs at least two to compare.'
    return (
      <DecisionOsPanel title="Activity trend">
        <p className="mt-2 text-sm leading-6 text-muted" data-testid="mission-control-trend-unavailable">
          {trend.reason === 'no_snapshots' ? 'no_snapshots' : 'insufficient_history'} — {message}
        </p>
      </DecisionOsPanel>
    )
  }
  const Icon = trend.direction === 'increasing' ? ArrowUp : trend.direction === 'decreasing' ? ArrowDown : ArrowRight
  return (
    <DecisionOsPanel title="Activity trend">
      <div className="mt-2 flex items-center gap-2" data-testid="mission-control-trend-available">
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

export default function MissionControlCard({ snapshot, variant = 'commissioner', compact = false }: MissionControlCardProps) {
  if (!snapshot) {
    return (
      <section data-testid={`mission-control-card-${variant}`} className={decisionOsCardClassName}>
        <div className="p-5">
          <DecisionOsEmptyState
            title="Mission Control is loading"
            description="Real league health, activity, and retention signals will appear here once loaded."
          />
        </div>
      </section>
    )
  }

  const { leagueHealth } = snapshot
  const engine = leagueHealth.available ? leagueHealth.result.engine : null
  const retentionRisk = snapshot.managersAtRetentionRisk
  const actions = snapshot.recommendedActions

  return (
    <section
      data-testid={`mission-control-card-${variant}`}
      className={decisionOsCardClassName}
      aria-label="Mission Control"
    >
      <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionOsBadge>Mission Control</DecisionOsBadge>
          {engine ? (
            <span
              data-testid="mission-control-health-status"
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${decisionOsHealthStatusToneClasses(engine.overallStatus)}`}
            >
              {engine.overallStatus}
            </span>
          ) : (
            <span
              data-testid="mission-control-health-unavailable"
              className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface-muted px-2.5 py-1 text-[11px] font-bold text-muted"
            >
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
              League health unavailable
            </span>
          )}
          <DecisionOsUpdatedStamp value={snapshot.generatedAt} includeTime />
        </div>
        <h2 className="mt-3 text-xl font-black tracking-tight text-primary">
          {engine ? engine.summary : 'League health data is not available for this league right now.'}
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

          {!leagueHealth.available ? (
            <DecisionOsInsufficientDataCallout
              title="League health unavailable"
              message="This league's health data couldn't be loaded right now."
              missing={['league health']}
            />
          ) : null}
        </div>

        <aside className="space-y-4">
          <DecisionOsPanel title="Managers at retention risk">
            {retentionRisk.length === 0 ? (
              <p className="mt-2 text-sm leading-6 text-muted" data-testid="mission-control-retention-empty">
                No managers currently flagged
              </p>
            ) : (
              <ul className="mt-2 space-y-2" data-testid="mission-control-retention-list">
                {(compact ? retentionRisk.slice(0, 3) : retentionRisk).map((risk) => (
                  <li key={risk.managerId} className="rounded-xl border border-subtle bg-surface-muted px-3 py-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-warning" aria-hidden />
                      <span className="text-sm font-bold text-primary">{risk.managerId}</span>
                      <span className="ml-auto text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
                        {risk.retentionRisk}
                      </span>
                    </div>
                    {risk.retentionRiskReasons.length > 0 ? (
                      <p className="mt-1 text-xs leading-5 text-secondary">{risk.retentionRiskReasons.join(', ')}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DecisionOsPanel>

          <DecisionOsPanel title="Recommended commissioner actions" className="bg-surface-muted">
            {actions.length === 0 ? (
              <p className="mt-2 text-sm leading-6 text-muted" data-testid="mission-control-actions-empty">
                No recommended actions right now
              </p>
            ) : (
              <ul className="mt-2 space-y-2" data-testid="mission-control-actions-list">
                {(compact ? actions.slice(0, 3) : actions).map((action, index) => (
                  <li key={`${action.priority}-${index}`} className="flex gap-2 text-sm leading-5 text-secondary">
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] ${
                        action.priority === 'urgent'
                          ? decisionOsToneClasses('danger')
                          : 'bg-surface text-muted'
                      }`}
                    >
                      {action.priority}
                    </span>
                    <span>{action.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </DecisionOsPanel>
        </aside>
      </div>
    </section>
  )
}
