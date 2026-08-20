'use client'

import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, ShieldCheck } from 'lucide-react'
import type { UserOsSnapshot } from '@/lib/decision-os/userOs'
import {
  DecisionOsBadge,
  DecisionOsEmptyState,
  DecisionOsInsufficientDataCallout,
  DecisionOsPanel,
  DecisionOsUpdatedStamp,
  decisionOsCardClassName,
} from './DecisionOsCardPrimitives'

type UserOsCardProps = {
  snapshot: UserOsSnapshot | null
  variant?: 'dashboard' | 'league' | 'commissioner'
}

const PARTICIPATION_TIER_LABEL: Record<string, string> = {
  elite: 'Elite',
  active: 'Active',
  moderate: 'Moderate',
  passive: 'Passive',
  inactive: 'Inactive',
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl border border-subtle bg-surface-muted px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-1 text-lg font-black text-primary">{value}</p>
    </div>
  )
}

function TrendPanel({ trend }: { trend: Extract<UserOsSnapshot, { available: true }>['leagueTrend'] }) {
  if (!trend.available) {
    const message =
      trend.reason === 'no_snapshots'
        ? 'No activity snapshots have been captured yet for this league.'
        : 'Only one snapshot captured so far — trend needs at least two to compare.'
    return (
      <DecisionOsPanel title="League activity trend">
        <p className="mt-2 text-sm leading-6 text-muted" data-testid="user-os-trend-unavailable">
          {trend.reason === 'no_snapshots' ? 'no_snapshots' : 'insufficient_history'} — {message}
        </p>
      </DecisionOsPanel>
    )
  }
  const Icon = trend.direction === 'increasing' ? ArrowUp : trend.direction === 'decreasing' ? ArrowDown : ArrowRight
  return (
    <DecisionOsPanel title="League activity trend">
      <div className="mt-2 flex items-center gap-2" data-testid="user-os-trend-available">
        <Icon className="h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
        <p className="text-sm font-bold text-primary">{trend.direction}</p>
      </div>
    </DecisionOsPanel>
  )
}

/**
 * User OS / Manager OS — the minimum single-manager surface, answering "what should I know about
 * my own team, whether or not I commission this league?" Deliberately does NOT render Manager DNA
 * or Recommendations — those are already shown by the sibling `ManagerDnaCard`/
 * `DecisionRecommendationsCard` on this same page; this card focuses on what's genuinely new: team
 * health and an activity summary.
 */
export default function UserOsCard({ snapshot, variant = 'league' }: UserOsCardProps) {
  if (!snapshot) {
    return (
      <section data-testid={`user-os-card-${variant}`} className={decisionOsCardClassName}>
        <div className="p-5">
          <DecisionOsEmptyState
            title="Your team intelligence is loading"
            description="Real activity, engagement, and league context will appear here once loaded."
          />
        </div>
      </section>
    )
  }

  if (!snapshot.available) {
    return (
      <section data-testid={`user-os-card-${variant}`} className={decisionOsCardClassName} aria-label="Your Team">
        <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
          <DecisionOsBadge>Your Team</DecisionOsBadge>
        </div>
        <div className="p-5">
          <div data-testid="user-os-unavailable">
            <DecisionOsInsufficientDataCallout
              title="Your team intelligence is unavailable"
              message="This league's data couldn't be loaded right now."
              missing={['manager activity']}
            />
          </div>
        </div>
      </section>
    )
  }

  const { teamHealth, activitySummary } = snapshot

  return (
    <section data-testid={`user-os-card-${variant}`} className={decisionOsCardClassName} aria-label="Your Team">
      <div className="border-b border-subtle bg-surface-muted/60 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <DecisionOsBadge>Your Team</DecisionOsBadge>
          <span
            data-testid="user-os-participation-tier"
            className="inline-flex items-center gap-1.5 rounded-full border border-subtle bg-surface-muted px-2.5 py-1 text-[11px] font-bold text-primary"
          >
            {teamHealth.isInactive ? (
              <AlertTriangle className="h-3.5 w-3.5 text-status-warning" aria-hidden />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 text-status-success" aria-hidden />
            )}
            {PARTICIPATION_TIER_LABEL[teamHealth.participationTier] ?? teamHealth.participationTier}
          </span>
          <DecisionOsUpdatedStamp value={snapshot.generatedAt} includeTime />
        </div>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatChip label="Trades" value={activitySummary.tradeEventCount} />
            <StatChip label="Waiver claims" value={activitySummary.waiverEventCount} />
            <StatChip label="Lineup activity" value={activitySummary.lineupEventCount} />
            <StatChip label="Draft picks" value={activitySummary.draftEventCount} />
          </div>
          <TrendPanel trend={snapshot.leagueTrend} />
        </div>

        <aside className="space-y-4">
          <DecisionOsPanel title="Retention risk" className="bg-surface-muted">
            {/* Phase 36: human-readable label — never the raw snake_case enum, and
                "Insufficient data" must read as a coverage gap, not a negative judgment. */}
            <p className="mt-2 text-sm font-bold text-primary" data-testid="user-os-retention-risk">
              {teamHealth.retentionRisk === 'insufficient_data'
                ? 'Insufficient data'
                : teamHealth.retentionRisk.charAt(0).toUpperCase() + teamHealth.retentionRisk.slice(1)}
            </p>
            {teamHealth.retentionRiskReasons.length > 0 ? (
              <p className="mt-1 text-xs leading-5 text-secondary">
                {teamHealth.retentionRiskReasons.join(', ')}
              </p>
            ) : (
              <p className="mt-1 text-xs leading-5 text-secondary">No risk factors identified</p>
            )}
          </DecisionOsPanel>
        </aside>
      </div>
    </section>
  )
}
