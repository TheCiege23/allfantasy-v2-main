/**
 * Fantasy OS Suite — Phase OS-B7: Demo Truthfulness & Executive Experience Pass.
 *
 * `CommissionerShowcasePanel` previously fabricated content when real data was unavailable:
 * `buildAiSummary` returned a hardcoded fake "League Health: 84/100" with invented items
 * ("3 inactive managers need a nudge", etc.) whenever `healthSnapshots` was empty, and
 * `buildRecommendations` returned a flat, fabricated "Draft is 92% ready" whenever the account
 * had zero commissioner leagues. Both are now honest: they degrade to "not yet available"
 * messaging instead of inventing numbers. This is the component's first dedicated render
 * coverage (previously only source-scanned for its OS-B6 badge rename).
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import CommissionerShowcasePanel from '@/components/redraft/CommissionerShowcasePanel'
import type { UserLeague } from '@/app/dashboard/types'
import type { CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'

function league(o: Partial<UserLeague> & Pick<UserLeague, 'id'>): UserLeague {
  return {
    name: 'Test League',
    platform: 'sleeper',
    sport: 'NFL',
    format: 'redraft',
    teamCount: 10,
    isCommissioner: true,
    ...o,
  }
}

function healthSnapshot(
  o: Partial<CommissionerLeagueHealthSnapshot> & Pick<CommissionerLeagueHealthSnapshot, 'leagueId'>,
): CommissionerLeagueHealthSnapshot {
  return {
    leagueName: 'Test League',
    sport: 'NFL',
    leagueType: 'redraft',
    season: 2026,
    status: 'in_season',
    teamCount: 10,
    currentWeek: 5,
    generatedAt: new Date().toISOString(),
    source: 'database',
    dataConfidence: 'high',
    healthScore: 82,
    engagementScore: 70,
    fairnessScore: 90,
    sustainabilityScore: 88,
    overallStatus: 'healthy',
    healthTrend: 'flat',
    summary: '',
    metrics: {
      inactiveTeams: 0,
      missedLineups: 0,
      tradeActivity: 0,
      waiverActivity: 0,
      leagueEngagement: 70,
      commissionerActions: 0,
      pendingWaiverClaims: 0,
      pendingTrades: 0,
      openAiAlerts: 0,
      chatMessagesLast7Days: 0,
      activeManagers: 10,
      injuredStarters: 0,
      lineupSubmissionRate: 1,
      projectionCoveragePct: 0,
      lowConfidenceProjectionStarters: 0,
    },
    alerts: [],
    recommendations: [],
    actions: [],
    assistantQuestions: [],
    ...o,
  }
}

describe('CommissionerShowcasePanel — never fabricates content (Phase OS-B7)', () => {
  it('does not fabricate an AI summary when there are zero health snapshots', () => {
    render(<CommissionerShowcasePanel leagues={[league({ id: 'league-1' })]} healthSnapshots={[]} />)

    expect(screen.getByText('League health not yet available')).toBeInTheDocument()
    expect(screen.queryByText('3 inactive managers need a nudge')).not.toBeInTheDocument()
    expect(screen.queryByText('1 trade is waiting for commissioner review')).not.toBeInTheDocument()
    expect(screen.queryByText('RB injury risk is trending up')).not.toBeInTheDocument()
    expect(screen.queryByText(/League Health: 84\/100/)).not.toBeInTheDocument()
  })

  it('does not fabricate a flat 92% draft readiness for a zero-league account', () => {
    render(<CommissionerShowcasePanel leagues={[]} healthSnapshots={[]} demoMode />)

    expect(screen.getByText('Draft readiness not yet available')).toBeInTheDocument()
    expect(screen.queryByText(/Draft is 92% ready/)).not.toBeInTheDocument()
  })

  it('renders a real AI summary score computed from real health snapshots', () => {
    render(
      <CommissionerShowcasePanel
        leagues={[league({ id: 'league-1' })]}
        healthSnapshots={[healthSnapshot({ leagueId: 'league-1', healthScore: 77 })]}
      />,
    )

    expect(screen.getByText('League Health: 77/100')).toBeInTheDocument()
  })

  it('never asserts "trending healthy" engagement when no engagement data exists', () => {
    render(
      <CommissionerShowcasePanel
        leagues={[league({ id: 'league-1' })]}
        healthSnapshots={[
          healthSnapshot({
            leagueId: 'league-1',
            healthScore: 77,
            metrics: {
              inactiveTeams: 0,
              missedLineups: 0,
              tradeActivity: 0,
              waiverActivity: 0,
              leagueEngagement: 0,
              commissionerActions: 0,
              pendingWaiverClaims: 0,
              pendingTrades: 0,
              openAiAlerts: 0,
              chatMessagesLast7Days: 0,
              activeManagers: 10,
              injuredStarters: 0,
              lineupSubmissionRate: 1,
              projectionCoveragePct: 0,
              lowConfidenceProjectionStarters: 0,
            },
          }),
        ]}
      />,
    )

    expect(screen.getByText("League engagement data isn't available yet")).toBeInTheDocument()
    expect(screen.queryByText('League engagement is trending healthy')).not.toBeInTheDocument()
  })

  it('computes a real, non-fabricated draft readiness percentage for a real commissioner league', () => {
    render(
      <CommissionerShowcasePanel
        leagues={[league({ id: 'league-1', lifecycleState: 'pre_draft', draftDate: null })]}
        healthSnapshots={[]}
      />,
    )

    expect(screen.getByText(/^Draft is \d+% ready$/)).toBeInTheDocument()
    expect(screen.queryByText('Draft is 92% ready')).not.toBeInTheDocument()
  })
})
