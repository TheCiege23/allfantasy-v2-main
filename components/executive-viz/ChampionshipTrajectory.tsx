'use client'

/**
 * Fantasy OS Suite — Phase V2.2: User (Manager) OS signature visualization.
 *
 * Championship Trajectory — the recognizable flagship for Manager OS, the User-OS counterpart to
 * Commissioner OS's League Health Map. It answers: "Where is my season heading?"
 *
 * Because the manager Decision OS contract carries no playoff-probability or standings history, this is
 * an executive DECISION snapshot (current cross-team standing + open decision urgency), never a
 * fabricated playoff-odds timeline — per the Step 1 audit. It consumes a `ChampionshipTrajectoryViewModel`
 * built from the existing `ManagerCommandCenterSnapshot`; no raw provider payloads, no player-level
 * records, no provider identifiers.
 */
import { useMemo } from 'react'
import { Trophy, ArrowUpRight, ArrowDownRight, Minus, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ManagerCommandCenterSnapshot } from '@/lib/decision-os/managerCommandCenter'
import {
  buildChampionshipTrajectory,
  type ChampionshipTrajectoryViewModel,
  type ManagerTrajectoryStatus,
} from '@/lib/executive-viz/managerSeasonViewModel'
import { ExecutiveProgressRing } from './ExecutiveCharts'
import { EXECUTIVE_STATUS_SURFACE } from './executiveVizTokens'
import {
  ExecutiveFreshnessStamp,
  ExecutiveUnavailableState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

const TRAJECTORY_LABEL: Record<ManagerTrajectoryStatus, string> = {
  on_track: 'On track',
  mixed: 'Mixed',
  needs_attention: 'Needs attention',
  unavailable: 'Not available',
}

function TrajectoryStatusChip({ status }: { status: ManagerTrajectoryStatus }) {
  const tone =
    status === 'on_track' ? 'excellent' : status === 'mixed' ? 'watch' : status === 'needs_attention' ? 'at_risk' : 'unavailable'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
        EXECUTIVE_STATUS_SURFACE[tone],
      )}
    >
      {TRAJECTORY_LABEL[status]}
    </span>
  )
}

function DirectionIndicator({ direction }: { direction: ChampionshipTrajectoryViewModel['activityDirection'] }) {
  if (!direction) return null
  const Icon = direction === 'increasing' ? ArrowUpRight : direction === 'decreasing' ? ArrowDownRight : Minus
  const label =
    direction === 'increasing' ? 'Activity rising' : direction === 'decreasing' ? 'Activity slowing' : 'Activity steady'
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-secondary" title="League activity trend, not a season-outcome forecast.">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  )
}

export function ChampionshipTrajectory({
  snapshot,
  loading = false,
}: {
  snapshot: ManagerCommandCenterSnapshot | null
  loading?: boolean
}) {
  const model = useMemo(() => buildChampionshipTrajectory(snapshot), [snapshot])

  return (
    <ExecutiveVisualizationShell
      title="Championship Trajectory"
      description="Where your season is heading right now."
      icon={Trophy}
      dominant
      meta={model?.available ? <ExecutiveFreshnessStamp updatedAt={model.updatedAt} /> : undefined}
      accessibleSummary={
        model?.available ? model.headline : 'Your season overview is not available yet. Connect a league to populate it.'
      }
    >
      {loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-surface-muted motion-reduce:animate-none" role="status" aria-label="Loading your season overview" />
      ) : !model || !model.available ? (
        <ExecutiveUnavailableState
          description="Your season trajectory appears once you belong to at least one connected, synced league — no sample data is shown in its place."
          missing={['A connected league', 'Recent activity']}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-[auto,1fr] sm:items-center">
          <div className="flex items-center justify-center">
            <ExecutiveProgressRing
              value={model.onTrackPct}
              status={model.ringStatus}
              label="Teams on track"
              valueLabel={`${model.teamsOnTrack}/${model.trackedTeams}`}
              size={104}
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TrajectoryStatusChip status={model.status} />
              <DirectionIndicator direction={model.activityDirection} />
            </div>
            <p className="mt-2 text-[15px] font-bold leading-snug text-primary">{model.headline}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-subtle bg-surface-muted px-2.5 py-1 font-semibold text-secondary">
                {model.teamsNeedingAttention} {model.teamsNeedingAttention === 1 ? 'team needs' : 'teams need'} attention
              </span>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-semibold',
                  model.urgentDecisions > 0 ? EXECUTIVE_STATUS_SURFACE.at_risk : 'border-subtle bg-surface-muted text-secondary',
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {model.urgentDecisions} urgent {model.urgentDecisions === 1 ? 'decision' : 'decisions'}
              </span>
            </div>

            {model.topDecisions.length > 0 ? (
              <div className="mt-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">What&apos;s driving this</p>
                <ul className="mt-2 space-y-1.5">
                  {model.topDecisions.map((decision) => (
                    <li key={decision.key} className="flex items-start gap-2 text-[12px]">
                      <span
                        className={cn(
                          'mt-0.5 inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase',
                          EXECUTIVE_STATUS_SURFACE[decision.status],
                        )}
                      >
                        {decision.priorityLabel}
                      </span>
                      <span className="min-w-0">
                        <span className="font-bold text-primary">{decision.label}</span>
                        <span className="text-secondary"> — {decision.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </ExecutiveVisualizationShell>
  )
}

export default ChampionshipTrajectory
