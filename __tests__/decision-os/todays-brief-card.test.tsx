import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import TodaysBriefCard from '@/components/decision-os/TodaysBriefCard'
import { composeDailyBrief } from '@/lib/decision-os/dailyBrief'
import { SEVERITY_RANK, type DecisionOsAttentionSignal } from '@/lib/decision-os/attentionSignals'

const NOW = new Date('2026-07-09T12:00:00Z')

function signal(o: Partial<DecisionOsAttentionSignal> & Pick<DecisionOsAttentionSignal, 'id' | 'leagueId' | 'severity' | 'type'>): DecisionOsAttentionSignal {
  return {
    priorityScore: SEVERITY_RANK[o.severity],
    title: 'Title',
    explanation: 'Explanation text',
    recommendedAction: null,
    timestamp: NOW.toISOString(),
    source: 'league_health_engine',
    ...o,
  }
}

const LEAGUE_NAMES = new Map([
  ['league-1', 'Dynasty Warriors'],
  ['league-2', 'Redraft Rebels'],
])

describe('TodaysBriefCard', () => {
  it('renders an honest healthy state with no priority items and no fabricated sections', () => {
    const brief = composeDailyBrief({ leaguesMonitored: 2, healthyLeagueCount: 2, draftsApproachingCount: 0, signals: [], leagueTrends: [] }, NOW)
    render(<TodaysBriefCard brief={brief} leagueNameById={LEAGUE_NAMES} />)

    expect(screen.getByTestId('todays-brief-summary')).toHaveTextContent('Every league looks healthy today.')
    expect(screen.getByTestId('todays-brief-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('todays-brief-priority-items')).not.toBeInTheDocument()
    expect(screen.queryByTestId('todays-brief-recommended-actions')).not.toBeInTheDocument()
    expect(screen.queryByTestId('todays-brief-positive-highlights')).not.toBeInTheDocument()
    expect(screen.queryByTestId('todays-brief-league-highlights')).not.toBeInTheDocument()
  })

  it('renders real priority items with the league name resolved via leagueNameById', () => {
    const brief = composeDailyBrief(
      {
        leaguesMonitored: 1,
        healthyLeagueCount: 0,
        draftsApproachingCount: 0,
        signals: [signal({ id: 'a', leagueId: 'league-2', severity: 'high', type: 'low_league_health', explanation: 'Health status is at_risk.' })],
        leagueTrends: [],
      },
      NOW,
    )
    render(<TodaysBriefCard brief={brief} leagueNameById={LEAGUE_NAMES} />)

    expect(screen.getByTestId('todays-brief-priority-items')).toHaveTextContent('Redraft Rebels')
    expect(screen.getByTestId('todays-brief-priority-items')).toHaveTextContent('Health status is at_risk.')
    expect(screen.queryByTestId('todays-brief-empty')).not.toBeInTheDocument()
  })

  it('renders recommended actions reused from the signals, never inventing new text', () => {
    const brief = composeDailyBrief(
      {
        leaguesMonitored: 1,
        healthyLeagueCount: 0,
        draftsApproachingCount: 0,
        signals: [signal({ id: 'a', leagueId: 'league-1', severity: 'high', type: 'low_league_health', recommendedAction: 'Review League Health.' })],
        leagueTrends: [],
      },
      NOW,
    )
    render(<TodaysBriefCard brief={brief} leagueNameById={LEAGUE_NAMES} />)

    expect(screen.getByTestId('todays-brief-recommended-actions')).toHaveTextContent('Review League Health.')
  })

  it('renders a positive highlight chip for a real high_league_health signal', () => {
    const brief = composeDailyBrief(
      {
        leaguesMonitored: 1,
        healthyLeagueCount: 1,
        draftsApproachingCount: 0,
        signals: [signal({ id: 'a', leagueId: 'league-1', severity: 'informational', type: 'high_league_health', title: 'League health is excellent' })],
        leagueTrends: [],
      },
      NOW,
    )
    render(<TodaysBriefCard brief={brief} leagueNameById={LEAGUE_NAMES} />)

    expect(screen.getByTestId('todays-brief-positive-highlights')).toHaveTextContent('Dynasty Warriors')
    expect(screen.getByTestId('todays-brief-positive-highlights')).toHaveTextContent('League health is excellent')
  })

  it('renders a league highlight chip for a real, non-flat trend', () => {
    const brief = composeDailyBrief(
      {
        leaguesMonitored: 1,
        healthyLeagueCount: 1,
        draftsApproachingCount: 0,
        signals: [],
        leagueTrends: [{ leagueId: 'league-1', direction: 'increasing', eventCountDelta: 8 }],
      },
      NOW,
    )
    render(<TodaysBriefCard brief={brief} leagueNameById={LEAGUE_NAMES} />)

    expect(screen.getByTestId('todays-brief-league-highlights')).toHaveTextContent('Dynasty Warriors')
    expect(screen.getByTestId('todays-brief-league-highlights')).toHaveTextContent('+8')
  })

  it('falls back to the raw league id when no display name is known', () => {
    const brief = composeDailyBrief(
      {
        leaguesMonitored: 1,
        healthyLeagueCount: 0,
        draftsApproachingCount: 0,
        signals: [signal({ id: 'a', leagueId: 'unknown-league', severity: 'high', type: 'low_league_health' })],
        leagueTrends: [],
      },
      NOW,
    )
    render(<TodaysBriefCard brief={brief} leagueNameById={new Map()} />)

    expect(screen.getByTestId('todays-brief-priority-items')).toHaveTextContent('unknown-league')
  })
})
