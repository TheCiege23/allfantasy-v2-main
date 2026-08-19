/**
 * Fantasy OS Suite — Phase OS-C2: Manager Priorities Alignment & Operating System Expansion.
 *
 * `ManagerPriorityModule` is the one generic component instantiated 3× (Lineup/Trade/Waiver) — this
 * covers category filtering, severity-based ordering (reusing `recommendation.priority` verbatim,
 * never re-deriving), the honest empty state, and that no field is fabricated (headline/why/evidence
 * all trace back to the real `Recommendation` object).
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { ListChecks } from 'lucide-react'

import ManagerPriorityModule from '@/components/decision-os/ManagerPriorityModule'
import type { ManagerCommandCenterRecommendation } from '@/lib/decision-os/managerCommandCenter'
import type { Recommendation } from '@/lib/decision-os/phase6/recommendations/types'

const LEAGUE_NAMES = new Map([['league-1', 'Dynasty Warriors']])

function recommendation(
  o: Partial<Recommendation> & Pick<Recommendation, 'id' | 'category' | 'priority'>,
): Recommendation {
  return {
    tier: 'manager',
    entityId: 'manager-1',
    severity: 'standard',
    confidence: 'high',
    affectedDimensions: [],
    expectedImpact: 'Real, deterministic expected-impact text.',
    derivation: [],
    evidence: [],
    benchmarkComparison: null,
    prerequisites: [],
    recommendedActions: [],
    rollbackCriteria: [],
    completeness: 100,
    uncertainty: [],
    ...o,
  }
}

function entry(leagueId: string, rec: Recommendation): ManagerCommandCenterRecommendation {
  return { leagueId, recommendation: rec }
}

describe('ManagerPriorityModule', () => {
  it('shows an honest empty state when nothing matches its category', () => {
    render(
      <ManagerPriorityModule
        title="Lineup Priorities"
        icon={ListChecks}
        category="lineup_discipline"
        entries={[entry('league-1', recommendation({ id: 'r1', category: 'trade_coaching', priority: 'high' }))]}
        leagueNameById={LEAGUE_NAMES}
        emptyMessage="No lineup priorities right now."
      />,
    )
    expect(screen.getByTestId('manager-priority-lineup_discipline-empty')).toHaveTextContent(
      'No lineup priorities right now.',
    )
  })

  it('only renders entries matching its own category', () => {
    render(
      <ManagerPriorityModule
        title="Lineup Priorities"
        icon={ListChecks}
        category="lineup_discipline"
        entries={[
          entry('league-1', recommendation({ id: 'r1', category: 'lineup_discipline', priority: 'high' })),
          entry('league-1', recommendation({ id: 'r2', category: 'trade_coaching', priority: 'critical' })),
        ]}
        leagueNameById={LEAGUE_NAMES}
        emptyMessage="empty"
      />,
    )
    expect(screen.getByTestId('manager-priority-lineup_discipline-item-r1')).toBeInTheDocument()
    expect(screen.queryByTestId('manager-priority-lineup_discipline-item-r2')).not.toBeInTheDocument()
  })

  it('orders entries by the recommendation\'s own real priority, highest severity first', () => {
    render(
      <ManagerPriorityModule
        title="Waiver Priorities"
        icon={ListChecks}
        category="waiver_opportunity"
        entries={[
          entry('league-1', recommendation({ id: 'low-one', category: 'waiver_opportunity', priority: 'low' })),
          entry('league-1', recommendation({ id: 'crit-one', category: 'waiver_opportunity', priority: 'critical' })),
        ]}
        leagueNameById={LEAGUE_NAMES}
        emptyMessage="empty"
      />,
    )
    const items = screen.getByTestId('manager-priority-waiver_opportunity-list').querySelectorAll('li')
    expect(items[0]).toHaveAttribute('data-testid', 'manager-priority-waiver_opportunity-item-crit-one')
    expect(items[1]).toHaveAttribute('data-testid', 'manager-priority-waiver_opportunity-item-low-one')
  })

  it('renders the real league name, the real first recommendedAction as headline, and real expectedImpact — never fabricated text', () => {
    render(
      <ManagerPriorityModule
        title="Trade Priorities"
        icon={ListChecks}
        category="trade_coaching"
        entries={[
          entry(
            'league-1',
            recommendation({
              id: 'r1',
              category: 'trade_coaching',
              priority: 'high',
              expectedImpact: 'Trading your surplus RB improves roster balance.',
              recommendedActions: [{ action: 'Offer your WR3 for a starting RB.', rationale: 'r' }],
              evidence: ['You have 4 startable RBs', 'Your WR corps is deep'],
            }),
          ),
        ]}
        leagueNameById={LEAGUE_NAMES}
        emptyMessage="empty"
      />,
    )
    const item = screen.getByTestId('manager-priority-trade_coaching-item-r1')
    expect(item).toHaveTextContent('Dynasty Warriors')
    expect(item).toHaveTextContent('Offer your WR3 for a starting RB.')
    expect(item).toHaveTextContent('Trading your surplus RB improves roster balance.')
    expect(item).toHaveTextContent('You have 4 startable RBs')
  })

  it('Phase OS-C3: falls back to a humanized real category (never the panel title) when a recommendation has no recommendedActions', () => {
    render(
      <ManagerPriorityModule
        title="Lineup Priorities"
        icon={ListChecks}
        category="lineup_discipline"
        entries={[entry('league-1', recommendation({ id: 'r1', category: 'lineup_discipline', priority: 'medium', recommendedActions: [] }))]}
        leagueNameById={LEAGUE_NAMES}
        emptyMessage="empty"
      />,
    )
    expect(screen.getByTestId('manager-priority-lineup_discipline-item-r1')).toHaveTextContent('Lineup discipline')
  })

  it('caps displayed entries at the limit prop', () => {
    const entries: ManagerCommandCenterRecommendation[] = Array.from({ length: 8 }, (_, i) =>
      entry('league-1', recommendation({ id: `r${i}`, category: 'waiver_opportunity', priority: 'medium' })),
    )
    render(
      <ManagerPriorityModule
        title="Waiver Priorities"
        icon={ListChecks}
        category="waiver_opportunity"
        entries={entries}
        leagueNameById={LEAGUE_NAMES}
        emptyMessage="empty"
        limit={3}
      />,
    )
    expect(screen.getByTestId('manager-priority-waiver_opportunity-list').querySelectorAll('li')).toHaveLength(3)
  })

  it('shows the real count in the panel title', () => {
    render(
      <ManagerPriorityModule
        title="Waiver Priorities"
        icon={ListChecks}
        category="waiver_opportunity"
        entries={[entry('league-1', recommendation({ id: 'r1', category: 'waiver_opportunity', priority: 'medium' }))]}
        leagueNameById={LEAGUE_NAMES}
        emptyMessage="empty"
      />,
    )
    expect(screen.getByText('Waiver Priorities (1)')).toBeInTheDocument()
  })
})
