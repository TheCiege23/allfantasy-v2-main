/**
 * Survivor AI host settings: the "Episode recaps" toggle saved a field nothing reads (the recap
 * generator is a stub), so it is gone; "Commissioner AI alerts" is refused by the server without AF
 * Commissioner, so the page gates it the same way instead of failing silently.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useSubscriptionGate', () => ({ useSubscriptionGateOptional: () => gate }))
vi.mock('@/components/subscription/SubscriptionGateBadge', () => ({ SubscriptionGateBadge: () => <span data-testid="gate-badge" /> }))
const gate = { gate: vi.fn() }

import { SurvivorAIHostPanel } from '@/app/league/[leagueId]/components/settings/survivor/SurvivorAIHostPanel'

function renderPanel(hasAfCommissionerSub: boolean) {
  const debouncedSave = vi.fn()
  render(
    <SurvivorAIHostPanel
      leagueId="L1"
      canEdit
      hasAfCommissionerSub={hasAfCommissionerSub}
      initialData={{ aiChimmyEnabled: true, aiRecaps: true, leagueAiCommissionerAlerts: false } as never}
      debouncedSave={debouncedSave}
    />,
  )
  const alerts = screen.getAllByRole('switch')[1]!
  return { debouncedSave, alerts }
}

describe('SurvivorAIHostPanel', () => {
  it('no longer offers an episode-recap toggle that changes nothing', () => {
    renderPanel(true)
    expect(screen.queryByText('Episode recaps')).toBeNull()
    expect(screen.getAllByRole('switch')).toHaveLength(2)
  })

  it('a free commissioner is shown the upgrade, and nothing is saved', () => {
    const { debouncedSave, alerts } = renderPanel(false)
    expect(screen.getByTestId('gate-badge')).toBeTruthy()
    fireEvent.click(alerts)
    expect(gate.gate).toHaveBeenCalledWith('commissioner_ai_tools')
    expect(debouncedSave).not.toHaveBeenCalled()
  })

  it('an AF Commissioner saves the alerts switch', () => {
    const { debouncedSave, alerts } = renderPanel(true)
    fireEvent.click(alerts)
    expect(debouncedSave).toHaveBeenCalledWith({ leagueAiCommissionerAlerts: true })
  })
})
