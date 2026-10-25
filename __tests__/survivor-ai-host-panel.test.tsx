/**
 * Survivor AI host settings: "Episode recaps" and "Commissioner AI alerts" are AF Commissioner
 * settings the server refuses without the plan, so the page gates them the same way instead of failing
 * silently. (Episode recaps are posted by lib/survivor/episodeRecap.ts.)
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
  const [, recaps, alerts] = screen.getAllByRole('switch')
  return { debouncedSave, recaps: recaps!, alerts: alerts! }
}

describe('SurvivorAIHostPanel', () => {
  it('offers Episode recaps, explaining that votes are told as counts', () => {
    renderPanel(true)
    expect(screen.getByText('Episode recaps')).toBeTruthy()
    expect(screen.getByText(/never who voted for whom/)).toBeTruthy()
  })

  it('a free commissioner cannot switch episode recaps; an AF Commissioner can', () => {
    const free = renderPanel(false)
    fireEvent.click(free.recaps)
    expect(gate.gate).toHaveBeenCalledWith('commissioner_ai_recap', { highlightParam: 'ai_recap' })
    expect(free.debouncedSave).not.toHaveBeenCalled()
  })

  it('an AF Commissioner switches episode recaps off', () => {
    const { debouncedSave, recaps } = renderPanel(true)
    fireEvent.click(recaps)
    expect(debouncedSave).toHaveBeenCalledWith({ aiRecaps: false })
  })

  it('a free commissioner is shown the upgrade, and nothing is saved', () => {
    const { debouncedSave, alerts } = renderPanel(false)
    expect(screen.getAllByTestId('gate-badge').length).toBe(2)
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
