import React from 'react'
import '@testing-library/jest-dom/vitest'
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

describe('Manager DNA compatibility card privacy', () => {
  it.each(['dashboard', 'league', 'commissioner', 'team'] as const)('withholds supplied profiles on %s surfaces', variant => {
    const model = buildManagerDnaViewModel({ source: profile, now })
    expect(model.primaryIdentity).toBe('Waiver Hawk') // Internal classifier/view adapter still works.
    render(<ManagerDnaCard profile={model} variant={variant} />)
    const card = screen.getByLabelText('Competitive Edge')
    expect(within(card).getByText(/Decision-specific negotiation evidence is still being connected/)).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/Waiver Hawk|Methodical|Risk Taking|manager-internal|High confidence|waiver_wire_aggressor/)
  })
  it('shows the same honest feature status without a profile', () => {
    render(<ManagerDnaCard profile={buildManagerDnaViewModel({ source: null, now })} />)
    expect(screen.getByText(/No acceptance prediction is available here yet/)).toBeInTheDocument()
    expect(screen.queryByText('Needs more history')).not.toBeInTheDocument()
  })
})
