/**
 * Fantasy OS Suite — Phase OS-B6: Demo Excellence Pass.
 *
 * `CommissionerLeagueHealthRanking` never had dedicated coverage (only an indirect, container-level
 * check via `commissioner-command-center-section.test.tsx`) — added now that this phase reduced it
 * from 4 ranking panels to 2 ("Needs the most attention" + "Most active leagues"), dropping the
 * "Healthiest leagues"/"Least active leagues" panels as redundant clutter for small league counts.
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

import CommissionerLeagueHealthRanking from '@/components/decision-os/CommissionerLeagueHealthRanking'
import type { CommissionerCommandCenterLeagueSummary } from '@/lib/decision-os/commissionerCommandCenter'

const LEAGUE_NAMES = new Map([
  ['league-1', 'Dynasty Warriors'],
  ['league-2', 'Redraft Rebels'],
])

function summary(o: Partial<CommissionerCommandCenterLeagueSummary> & Pick<CommissionerCommandCenterLeagueSummary, 'leagueId'>): CommissionerCommandCenterLeagueSummary {
  return {
    available: true,
    overallStatus: 'healthy',
    leagueHealthScore: 80,
    activeManagers: 10,
    inactiveManagers: 0,
    retentionRiskCount: 0,
    urgentActionCount: 0,
    tradeCount: 0,
    waiverClaimCount: 0,
    draftPickCount: 0,
    rosterActivityCount: 0,
    ...o,
  }
}

describe('CommissionerLeagueHealthRanking', () => {
  it('shows a loading empty state for a fully empty summaries array', () => {
    render(<CommissionerLeagueHealthRanking summaries={[]} leagueNameById={LEAGUE_NAMES} />)
    expect(screen.getByText(/League health ranking is loading/)).toBeInTheDocument()
  })

  it('shows an honest unavailable state when no summary is available', () => {
    render(
      <CommissionerLeagueHealthRanking
        summaries={[summary({ leagueId: 'league-1', available: false, overallStatus: null, leagueHealthScore: null })]}
        leagueNameById={LEAGUE_NAMES}
      />,
    )
    expect(screen.getByTestId('league-health-ranking-unavailable')).toBeInTheDocument()
  })

  it('renders exactly 2 ranking panels — "Needs the most attention" and "Most active leagues"', () => {
    render(
      <CommissionerLeagueHealthRanking
        summaries={[summary({ leagueId: 'league-1', leagueHealthScore: 82, tradeCount: 5 })]}
        leagueNameById={LEAGUE_NAMES}
      />,
    )
    expect(screen.getByText('Needs the most attention')).toBeInTheDocument()
    expect(screen.getByText('Most active leagues')).toBeInTheDocument()
    expect(screen.queryByText('Healthiest leagues')).not.toBeInTheDocument()
    expect(screen.queryByText('Least active leagues')).not.toBeInTheDocument()
  })

  it('a real league appears in both panels without being a fabricated duplicate — real data, shown twice by design', () => {
    render(
      <CommissionerLeagueHealthRanking
        summaries={[summary({ leagueId: 'league-1', leagueHealthScore: 41, tradeCount: 3 })]}
        leagueNameById={LEAGUE_NAMES}
      />,
    )
    expect(screen.getByTestId('league-health-ranking-least-healthy')).toHaveTextContent('Dynasty Warriors')
    expect(screen.getByTestId('league-health-ranking-least-healthy')).toHaveTextContent('41/100')
    expect(screen.getByTestId('league-health-ranking-most-active')).toHaveTextContent('Dynasty Warriors')
    expect(screen.getByTestId('league-health-ranking-most-active')).toHaveTextContent('3 events')
  })

  it('ranks lowest health score first in "Needs the most attention"', () => {
    render(
      <CommissionerLeagueHealthRanking
        summaries={[
          summary({ leagueId: 'league-1', leagueHealthScore: 90 }),
          summary({ leagueId: 'league-2', leagueHealthScore: 30 }),
        ]}
        leagueNameById={LEAGUE_NAMES}
      />,
    )
    const items = screen.getByTestId('league-health-ranking-least-healthy').querySelectorAll('li')
    expect(items[0]).toHaveTextContent('Redraft Rebels')
    expect(items[1]).toHaveTextContent('Dynasty Warriors')
  })

  it('ranks highest activity first in "Most active leagues"', () => {
    render(
      <CommissionerLeagueHealthRanking
        summaries={[
          summary({ leagueId: 'league-1', tradeCount: 1 }),
          summary({ leagueId: 'league-2', tradeCount: 10 }),
        ]}
        leagueNameById={LEAGUE_NAMES}
      />,
    )
    const items = screen.getByTestId('league-health-ranking-most-active').querySelectorAll('li')
    expect(items[0]).toHaveTextContent('Redraft Rebels')
    expect(items[1]).toHaveTextContent('Dynasty Warriors')
  })

  it('excludes leagues without a real health score from "Needs the most attention" — never fabricates a rank', () => {
    render(
      <CommissionerLeagueHealthRanking
        summaries={[summary({ leagueId: 'league-1', leagueHealthScore: null })]}
        leagueNameById={LEAGUE_NAMES}
      />,
    )
    expect(screen.getByTestId('league-health-ranking-least-healthy-empty')).toHaveTextContent('No scored leagues yet.')
  })

  it('falls back to the raw league id when no display name is known', () => {
    render(
      <CommissionerLeagueHealthRanking
        summaries={[summary({ leagueId: 'unknown-league', leagueHealthScore: 50 })]}
        leagueNameById={new Map()}
      />,
    )
    expect(screen.getByTestId('league-health-ranking-least-healthy')).toHaveTextContent('unknown-league')
  })
})
