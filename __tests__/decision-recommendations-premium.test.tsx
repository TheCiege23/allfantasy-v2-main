import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DecisionRecommendationsCard from '@/components/decision-os/DecisionRecommendationsCard'
import { buildDecisionRecommendationsViewModel } from '@/lib/decision-os/recommendations'
import type { RecommendationSet } from '@/lib/decision-os/phase6/recommendations/types'

const now = new Date('2026-07-01T16:00:00.000Z')

const recommendationSet: RecommendationSet = {
  entityId: 'manager-private-1',
  tier: 'manager',
  totalRecommendations: 3,
  criticalCount: 1,
  warnings: [],
  version: '6.4.0',
  recommendations: [
    {
      id: 'rec_manager_waiver_opportunity_manager_private_1',
      tier: 'manager',
      category: 'waiver_opportunity',
      entityId: 'manager-private-1',
      priority: 'low',
      severity: 'advisory',
      confidence: 'medium',
      affectedDimensions: ['waivers'],
      expectedImpact: 'Adds a useful bench option without changing the roster core',
      derivation: ['waiver signal available'],
      evidence: ['Available player fits bench need'],
      benchmarkComparison: null,
      prerequisites: ['Open roster slot'],
      recommendedActions: [{ action: 'Review the top waiver fit', rationale: 'Low-risk bench upgrade' }],
      rollbackCriteria: ['Dismiss after waiver window closes'],
      completeness: 72,
      uncertainty: [],
    },
    {
      id: 'rec_manager_engagement_boost_manager_private_1',
      tier: 'manager',
      category: 'engagement_boost',
      entityId: 'manager-private-1',
      priority: 'critical',
      severity: 'urgent',
      confidence: 'high',
      affectedDimensions: ['engagement'],
      expectedImpact: 'Improved lineup setting, waiver participation, and seasonal roster performance',
      derivation: ['inactivity gap detected'],
      evidence: ['Inactivity gap detected'],
      benchmarkComparison: null,
      prerequisites: ['Active league roster'],
      recommendedActions: [{ action: 'Enable weekly lineup reminder notifications', rationale: 'Reduce missed lineups' }],
      rollbackCriteria: ['Dismiss after reliable weekly activity returns'],
      completeness: 88,
      uncertainty: [],
    },
    {
      id: 'rec_manager_lineup_discipline_manager_private_1',
      tier: 'manager',
      category: 'lineup_discipline',
      entityId: 'manager-private-1',
      priority: 'medium',
      severity: 'standard',
      confidence: 'medium',
      affectedDimensions: ['lineup'],
      expectedImpact: 'Fewer last-minute lineup regrets',
      derivation: ['lineup indecision signal'],
      evidence: ['Repeated lineup changes'],
      benchmarkComparison: null,
      prerequisites: ['Lineup history'],
      recommendedActions: [{ action: 'Set a weekly lineup deadline', rationale: 'Reduce late tinkering' }],
      rollbackCriteria: ['Dismiss after two stable weeks'],
      completeness: 67,
      uncertainty: ['Limited sample'],
    },
  ],
}

describe('Decision recommendations premium card', () => {
  it('renders top recommendations in deterministic priority order', () => {
    const model = buildDecisionRecommendationsViewModel({ source: recommendationSet, now })

    expect(model.recommendations.map((item) => item.title)).toEqual([
      'Boost Engagement',
      'Lineup Discipline',
      'Waiver Wire Opportunity',
    ])

    render(<DecisionRecommendationsCard model={model} variant="dashboard" />)

    const card = screen.getByTestId('decision-recommendations-card-dashboard')
    const headings = within(card).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['Boost Engagement', 'Lineup Discipline', 'Waiver Wire Opportunity'])
    expect(within(card).getByText('Critical')).toBeInTheDocument()
    expect(within(card).getAllByText('Suggested action')).toHaveLength(3)
    expect(within(card).getByText('Inactivity gap detected')).toBeInTheDocument()
    expect(card.textContent).not.toContain('manager-private-1')
    expect(card.textContent).not.toContain('rec_manager')
    expect(card.textContent).not.toMatch(/Decision OS|derivation|backend/i)
  })

  it('renders insufficient-data state when no grounded actions are available', () => {
    const model = buildDecisionRecommendationsViewModel({ source: null, now })

    render(<DecisionRecommendationsCard model={model} variant="league" />)

    const card = screen.getByTestId('decision-recommendations-card-league')
    expect(within(card).getByText('No grounded recommendations yet')).toBeInTheDocument()
    expect(within(card).getByText('Low confidence')).toBeInTheDocument()
    expect(within(card).getByText('No grounded moves are ready yet.')).toBeInTheDocument()
  })

  it('has an accessible card label', () => {
    const model = buildDecisionRecommendationsViewModel({ source: recommendationSet, now })
    render(<DecisionRecommendationsCard model={model} variant="commissioner" compact />)

    expect(screen.getByLabelText(/Recommended Moves: Personal action queue/i)).toBeInTheDocument()
  })
})
