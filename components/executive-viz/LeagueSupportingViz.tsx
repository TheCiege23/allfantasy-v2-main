'use client'

/**
 * Fantasy OS Suite — Phase V2.3: League OS supporting executive visualizations.
 *
 * Three supporting graphs that reinforce the League Momentum flagship, each answering one league-level
 * question about the ecosystem (never an individual manager/player):
 *
 *   - TransactionDistributionCard → "Where is league activity occurring?"
 *   - LeagueEngagementCard        → "Which parts of the league are active or quiet?"
 *   - CompetitiveBalanceCard      → "Is this league balanced?"
 *
 * Built from the existing `LeagueAnalyticsSnapshot` (+ the already-loaded `fairnessScore` for balance) —
 * no new fetch, no new intelligence, no player-level records, no provider identifiers.
 */
import { useMemo } from 'react'
import { PieChart, UsersRound, Scale } from 'lucide-react'
import type { LeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import {
  buildTransactionDistribution,
  buildLeagueEngagement,
  buildCompetitiveBalance,
} from '@/lib/executive-viz/leagueMomentumViewModel'
import { ExecutiveHorizontalBars, ExecutiveProgressRing } from './ExecutiveCharts'
import {
  ExecutiveEmptyState,
  ExecutiveUnavailableState,
  ExecutiveVisualizationShell,
} from './ExecutiveVisualizationShell'

export function TransactionDistributionCard({ snapshot }: { snapshot: LeagueAnalyticsSnapshot | null }) {
  const model = useMemo(() => buildTransactionDistribution(snapshot), [snapshot])
  return (
    <ExecutiveVisualizationShell
      title="Transaction Distribution"
      description="Where league activity is occurring."
      icon={PieChart}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Transaction activity appears once this league is connected and synced." />
      ) : model.items.length === 0 ? (
        <ExecutiveEmptyState
          icon={PieChart}
          title="No transactions yet"
          description="No trades, waivers, roster moves, or draft picks have been recorded in this league yet."
        />
      ) : (
        <>
          <p className="mb-3 text-[12px] font-semibold text-secondary">{model.headline}</p>
          <ExecutiveHorizontalBars items={model.items} />
        </>
      )}
    </ExecutiveVisualizationShell>
  )
}

export function LeagueEngagementCard({ snapshot }: { snapshot: LeagueAnalyticsSnapshot | null }) {
  const model = useMemo(() => buildLeagueEngagement(snapshot), [snapshot])
  return (
    <ExecutiveVisualizationShell
      title="Engagement Summary"
      description="Which parts of the league are active or quiet."
      icon={UsersRound}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Engagement appears once this league is connected and synced." />
      ) : model.items.length === 0 ? (
        <ExecutiveEmptyState
          icon={UsersRound}
          title="No manager activity yet"
          description="This league hasn't recorded manager activity yet — engagement appears once managers start making moves."
        />
      ) : (
        <>
          <p className="mb-3 text-[12px] font-semibold text-secondary">{model.headline}</p>
          <ExecutiveHorizontalBars items={model.items} />
        </>
      )}
    </ExecutiveVisualizationShell>
  )
}

export function CompetitiveBalanceCard({ healthSnapshot }: { healthSnapshot: CommissionerLeagueHealthSnapshot | null }) {
  const model = useMemo(() => buildCompetitiveBalance(healthSnapshot), [healthSnapshot])
  return (
    <ExecutiveVisualizationShell
      title="Competitive Balance"
      description="Is this league still competitive?"
      icon={Scale}
      accessibleSummary={model.headline}
    >
      {!model.available ? (
        <ExecutiveUnavailableState description="Competitive balance appears once this league's health has been computed." />
      ) : (
        <div className="flex flex-col items-center gap-3">
          <ExecutiveProgressRing
            value={model.fairnessScore}
            status={model.status}
            label={model.label}
            valueLabel={`${model.fairnessScore}`}
            size={104}
          />
          <p className="text-center text-[12px] font-semibold text-secondary">{model.headline}</p>
        </div>
      )}
    </ExecutiveVisualizationShell>
  )
}
