import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ManagerDnaCard from '@/components/decision-os/ManagerDnaCard'
import { buildManagerDnaViewModel } from '@/lib/decision-os/manager-dna'
import type { ManagerDnaProfile } from '@/lib/decision-os/phase6/dna/types'

const now = new Date('2026-07-01T16:00:00.000Z')

const profile: ManagerDnaProfile = {
  managerId: 'manager-internal-123',
  leagueId: 'league-internal-456',
  primaryIdentity: 'waiver_hawk',
  confidence: 0.86,
  decisionStyle: 'methodical',
  transactionStyle: 'waiver_dominant',
  riskTendency: 'risk_taking',
  engagementReliability: 'reliable',
  traits: [
    { trait: 'waiver_wire_aggressor', strength: 'strong', evidence: ['waiver pattern'] },
    { trait: 'steady_lineup_manager', strength: 'moderate', evidence: ['lineup cadence'] },
  ],
  derivation: ['waiver_hawk score crossed threshold', 'transaction style favors waivers'],
  warnings: [],
  completeness: 91,
}

describe('Manager DNA premium card', () => {
  it('adapts completed manager DNA output without exposing internal ids or backend wording', () => {
    const model = buildManagerDnaViewModel({ source: profile, now })

    expect(model.primaryIdentity).toBe('Waiver Hawk')
    expect(model.decisionStyle).toBe('Methodical')
    expect(model.transactionStyle).toBe('Waiver Dominant')
    expect(model.confidenceLabel).toBe('High')

    render(<ManagerDnaCard profile={model} variant="dashboard" />)

    const card = screen.getByTestId('manager-dna-card-dashboard')
    expect(within(card).getByText('Waiver Hawk')).toBeInTheDocument()
    expect(within(card).getByText('High confidence')).toBeInTheDocument()
    expect(within(card).getByText('Supporting evidence')).toBeInTheDocument()
    expect(within(card).getByText('Coaching focus')).toBeInTheDocument()
    expect(card.textContent).not.toContain('manager-internal-123')
    expect(card.textContent).not.toContain('league-internal-456')
    expect(card.textContent).not.toMatch(/Decision OS|derivation|classifier|backend/i)
  })

  it('renders graceful insufficient data fallback', () => {
    const model = buildManagerDnaViewModel({ source: null, now })

    render(<ManagerDnaCard profile={model} variant="league" />)

    const card = screen.getByTestId('manager-dna-card-league')
    expect(within(card).getByText('Needs more history')).toBeInTheDocument()
    expect(within(card).getByText('Low confidence')).toBeInTheDocument()
    expect(within(card).getByText('Not enough manager history yet')).toBeInTheDocument()
    expect(within(card).getByText(/Play a few more weeks/i)).toBeInTheDocument()
  })

  it('has an accessible card label and stable snapshot', () => {
    const model = buildManagerDnaViewModel({ source: profile, now })
    const { container } = render(<ManagerDnaCard profile={model} variant="team" compact />)

    expect(screen.getByLabelText(/Manager DNA: Waiver Hawk/i)).toBeInTheDocument()
    expect(container.firstChild).toMatchSnapshot()
  })
})
