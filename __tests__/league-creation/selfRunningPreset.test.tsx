/** Dynasty creation: "How much should AllFantasy run?" (phase 10, 2026-10-29). */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/hooks/useEntitlement', () => ({ useEntitlement: () => ({ loading: false, featureAccess: true, upgradePath: null }) }))

import { AiAutomationSettingsPanel } from '@/components/league-creation-wizard/AiAutomationSettingsPanel'
import { DEFAULT_AI_SETTINGS, DEFAULT_AUTOMATION_SETTINGS, DEFAULT_COMMISSIONER_PREFERENCES } from '@/lib/league-creation-wizard/types'
import { DEFAULT_SELF_RUNNING_PRESET, offersSelfRunningPreset } from '@/lib/league-creation-wizard/selfRunningPreset'
import { isAutomationPreset } from '@/lib/commissioner-hub/automationPreset'

const panel = (leagueType: 'dynasty' | 'redraft', onAutomationChange = vi.fn(), selfRunningPreset?: 'hands_on' | 'recommended' | 'run_it') =>
  render(
    <AiAutomationSettingsPanel
      leagueType={leagueType}
      sport="NFL"
      aiSettings={DEFAULT_AI_SETTINGS}
      automationSettings={{ ...DEFAULT_AUTOMATION_SETTINGS, ...(selfRunningPreset ? { selfRunningPreset } : {}) }}
      commissionerPreferences={DEFAULT_COMMISSIONER_PREFERENCES}
      onAiChange={vi.fn()}
      onAutomationChange={onAutomationChange}
      onCommissionerChange={vi.fn()}
    />,
  )

describe('the choice', () => {
  it('is offered for dynasty, devy and C2C leagues only', () => {
    expect(['dynasty', 'devy', 'c2c'].every((t) => offersSelfRunningPreset(t as never))).toBe(true)
    expect(['redraft', 'keeper', 'best_ball', 'survivor'].some((t) => offersSelfRunningPreset(t as never))).toBe(false)
  })

  it('defaults to Recommended, and every option is a preset the hub knows', () => {
    expect(DEFAULT_AUTOMATION_SETTINGS.selfRunningPreset).toBe('recommended')
    expect(DEFAULT_SELF_RUNNING_PRESET).toBe('recommended')
    for (const id of ['hands_on', 'recommended', 'run_it']) expect(isAutomationPreset(id)).toBe(true)
  })

  it('shows three options on a dynasty league, with Recommended selected, and saves a change', () => {
    const onChange = vi.fn()
    panel('dynasty', onChange)
    expect((screen.getByTestId('self-running-recommended') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByTestId('self-running-run_it'))
    expect(onChange).toHaveBeenCalledWith({ selfRunningPreset: 'run_it' })
  })

  it('is not shown on a redraft league', () => {
    panel('redraft')
    expect(screen.queryByTestId('self-running-preset')).toBeNull()
  })
})
