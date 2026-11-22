/**
 * Inline validation, step gating, format explainers, help and funnel analytics in the create
 * wizard. Next checks the step it is leaving; errors appear beside the field as the manager types.
 */
import React, { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const beacon = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analytics/client', () => ({ sendProductAnalyticsBeacon: beacon }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (k: string) => k, language: 'en' }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasCommissioner: false, loading: false }) }))
// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({ default: (props: { alt: string }) => <img alt={props.alt} /> }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({
  CreateLeagueVideoTile: ({ title, onSelect, testId }: { title: string; onSelect: () => void; testId: string }) => (
    <button type="button" onClick={onSelect} data-testid={testId}>
      {title}
    </button>
  ),
}))

import { CreateLeagueWizard, freshCreateLeagueState } from '@/components/create-league-v2/CreateLeagueWizard'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'

function Harness({ initial }: { initial?: Partial<CreateLeagueV2State> }) {
  const [state, setState] = useState<CreateLeagueV2State>({
    ...freshCreateLeagueState(DEFAULT_V2_STATE),
    sport: 'NFL',
    leagueType: 'redraft',
    scoringPresetId: 'fb_half_ppr',
    timezone: 'America/New_York',
    draftScheduleLater: true,
    name: '',
    ...initial,
  })
  return (
    <CreateLeagueWizard
      state={state}
      onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
      completionIssues={analyzeCreateLeagueCompletion(state)}
      fieldErrors={null}
      submitError={null}
      submitting={false}
      onSubmit={vi.fn()}
      onCancel={vi.fn()}
      lastSavedAt={Date.now()}
    />
  )
}

beforeEach(() => beacon.mockClear())
afterEach(cleanup)

const events = (name: string) => beacon.mock.calls.filter(([e]) => e === name).map(([, meta]) => meta)

describe('create league wizard — guidance and validation', () => {
  it('shows how many steps are left and that progress is saved', () => {
    render(<Harness />)
    expect(screen.getByTestId('g30-step-progress')).toHaveTextContent('Step 1 of 4 · 3 steps left')
    expect(screen.getByTestId('g30-autosave')).toHaveTextContent('Progress saved just now')
  })

  it('stops Next on a step with a mistake and says what to fix', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('g30-next')) // Sport has nothing to fix
    expect(screen.getByTestId('g30-step-progress')).toHaveTextContent('Step 2 of 4')

    fireEvent.click(screen.getByTestId('g30-next'))
    expect(screen.getByTestId('g30-step-progress')).toHaveTextContent('Step 2 of 4') // did not advance
    expect(screen.getByTestId('g30-step-notice')).toHaveTextContent('Give your league a name.')

    fireEvent.change(screen.getByTestId('g30-league-name'), { target: { value: 'Sunday Funday' } })
    expect(screen.queryByTestId('g30-step-notice')).toBeNull()
    fireEvent.click(screen.getByTestId('g30-next'))
    expect(screen.getByTestId('g30-step-progress')).toHaveTextContent('Step 3 of 4')
  })

  it('shows a draft-date error beside the field once the manager tries to leave the step', () => {
    render(<Harness initial={{ name: 'Sunday Funday', draftScheduleLater: false, draftDate: '', draftTime: '' }} />)
    fireEvent.click(screen.getByTestId('g30-step-draft'))
    expect(screen.queryByText(/Pick a draft date/)).toBeNull()
    fireEvent.click(screen.getByTestId('g30-next'))
    expect(screen.getAllByText(/Pick a draft date, or choose "Schedule later"/).length).toBeGreaterThan(0)
    expect(screen.getByTestId('g30-draft-date')).toHaveAttribute('aria-invalid', 'true')
  })

  it('explains the chosen format under the format tiles', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('g30-step-basics'))
    fireEvent.click(screen.getByTestId('g30-league-type-keeper'))
    expect(screen.getByTestId('g30-format-explainer')).toHaveTextContent(/each team keeps a few players/i)
  })

  it('has help for keeper cost', () => {
    render(<Harness initial={{ leagueType: 'keeper', name: 'Sunday Funday' }} />)
    fireEvent.click(screen.getByTestId('g30-step-draft'))
    expect(screen.getByTestId('g30-help-keeper-cost')).toBeTruthy()
  })

  it('logs field and step names, never what was typed', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('g30-step-basics'))
    fireEvent.change(screen.getByTestId('g30-league-name'), { target: { value: 'Pr1vate Name' } })
    fireEvent.change(screen.getByTestId('g30-league-name'), { target: { value: 'ab' } })
    fireEvent.click(screen.getByTestId('g30-step-sport'))

    expect(events('product.create_league.validation_error')).toEqual(
      expect.arrayContaining([expect.objectContaining({ step: 'basics', field: 'leagueName', code: 'league_name_invalid' })]),
    )
    expect(events('product.create_league.step_back')).toEqual([{ flow: 'g30', from: 'basics', to: 'sport' }])
    expect(JSON.stringify(beacon.mock.calls)).not.toMatch(/Pr1vate|"ab"/)
  })
})
