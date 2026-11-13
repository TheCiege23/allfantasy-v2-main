/** The rebuild plan card on the Trade Center (components/core-app/screens/RebuildPlanCard.tsx). */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RebuildPlanCard } from '@/components/core-app/screens/RebuildPlanCard'
import type { RebuildPlan } from '@/lib/trade-intel/rebuildAdvisor'

const asset = (id: string, value: number, kind: 'player' | 'pick' = 'player') => ({ id, name: id, position: kind === 'pick' ? 'PICK' : 'RB', value, kind })

const plan: RebuildPlan = {
  trigger: 'eliminated',
  basis: 'You are 4 wins back of the last playoff spot with 3 weeks to play, so you cannot get there.',
  sell: [{ asset: asset('Vet RB', 5000), why: 'Sell why.', buyers: [{ rosterId: 'aces', ownerName: 'Aces', why: 'In the race, and he would start over Aces RB2.' }] }],
  hold: [{ asset: asset('Young WR', 4000), why: 'Hold why.' }],
  targets: [{ asset: asset('2027 1st (Aces)', 2600, 'pick'), rosterId: 'aces', ownerName: 'Aces', why: 'Target why.' }],
  packages: [{ rosterId: 'aces', ownerName: 'Aces', give: [asset('Vet RB', 5000)], get: [asset('2027 1st (Aces)', 2600, 'pick'), asset('Aces Rookie WR', 2600)], percentApart: 0.038, why: 'Package why.' }],
  gaps: ['A gap.'],
}

describe('RebuildPlanCard', () => {
  it('shows why, then sell (with buyers), hold, targets and a fair offer that loads into the builder', () => {
    const onStartWith = vi.fn()
    render(<RebuildPlanCard plan={plan} onStartWith={onStartWith} />)
    expect(screen.getByText(plan.basis)).toBeTruthy()
    expect(screen.getByText('Sell while it pays')).toBeTruthy()
    // The buyer, on its own line with its reason, inside the sell group.
    const buyer = screen.getByText('In the race, and he would start over Aces RB2.').closest('li')!
    expect(buyer.textContent).toContain('Aces')
    expect(screen.getByText('Hold for next year')).toBeTruthy()
    expect(screen.getByText('Ask contenders for')).toBeTruthy()
    expect(screen.getByText('4% apart')).toBeTruthy()
    expect(screen.getByText('A gap.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start with this deal' }))
    expect(onStartWith).toHaveBeenCalledWith(plan.packages[0])
  })

  it('renders nothing without a plan', () => {
    const { container } = render(<RebuildPlanCard plan={null} onStartWith={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })
})
