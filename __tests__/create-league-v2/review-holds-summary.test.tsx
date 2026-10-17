/**
 * Summary was folded into Review on 2026-10-12 (user's call): four steps, not five. Review now
 * carries what Summary showed — the four key settings, each tappable back to its step — and the
 * AF Commissioner advanced-setup panel.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key, language: 'en' }) }))
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ({ hasCommissioner: false, loading: false }) }))
// eslint-disable-next-line @next/next/no-img-element
vi.mock('next/image', () => ({ default: (props: { alt: string }) => <img alt={props.alt} /> }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({
  CreateLeagueVideoTile: ({ testId, onSelect, title }: { testId: string; onSelect: () => void; title: string }) => (
    <button data-testid={testId} onClick={onSelect}>{title}</button>
  ),
}))

import { CreateLeagueWizard, ReviewCreateStep, freshCreateLeagueState } from '@/components/create-league-v2/CreateLeagueWizard'

const state = { ...freshCreateLeagueState(DEFAULT_V2_STATE), name: 'Island League', nameTouched: true }

describe('the wizard has four steps', () => {
  it('Sport, Basics, Draft, Review — and no Summary', () => {
    render(
      <CreateLeagueWizard state={state} onChange={vi.fn()} completionIssues={[]} fieldErrors={null} submitError={null}
        submitting={false} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    )
    const steps = screen.getAllByRole('button').map((b) => b.getAttribute('data-testid') ?? '').filter((id) => id.startsWith('g30-step-'))
    expect(steps).toEqual(['g30-step-sport', 'g30-step-basics', 'g30-step-draft', 'g30-step-review'])
  })

  it('Next from Draft goes straight to Review, where the Commissioner panel now lives', () => {
    render(
      <CreateLeagueWizard state={state} onChange={vi.fn()} completionIssues={[]} fieldErrors={null} submitError={null}
        submitting={false} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByTestId('g30-step-draft'))
    fireEvent.click(screen.getByRole('button', { name: /createLeague\.g30\.next/ }))
    expect(screen.getByTestId('g30-review-step')).toBeTruthy()
    expect(screen.getByTestId('g30-advanced-panel')).toBeTruthy()
    expect(screen.getByTestId('g30-commissioner-upsell')).toBeTruthy()
    expect(screen.getByTestId('g30-create-league-submit')).toBeTruthy()
  })
})

describe('Review carries the settings Summary showed', () => {
  it('each settings tile opens the step that changes it', () => {
    const onEditStep = vi.fn()
    render(<ReviewCreateStep state={state} completionIssues={[]} submitError={null} onEditStep={onEditStep} />)
    fireEvent.click(screen.getByTestId('g30-review-edit-sport'))
    fireEvent.click(screen.getByTestId('g30-review-edit-format'))
    fireEvent.click(screen.getByTestId('g30-review-edit-teams'))
    fireEvent.click(screen.getByTestId('g30-review-edit-draft'))
    expect(onEditStep.mock.calls.map(([step]) => step)).toEqual(['sport', 'basics', 'basics', 'draft'])
    expect(screen.getByTestId('g30-review-settings').textContent).toContain('NFL')
  })

  it('the advanced panel renders only when Review is given onChange', () => {
    const view = render(<ReviewCreateStep state={state} completionIssues={[]} submitError={null} />)
    expect(screen.queryByTestId('g30-advanced-panel')).toBeNull()
    view.rerender(<ReviewCreateStep state={state} completionIssues={[]} submitError={null} onChange={vi.fn()} hasCommissioner />)
    expect(screen.getByTestId('g30-advanced-panel')).toBeTruthy()
    expect(screen.queryByTestId('g30-commissioner-upsell')).toBeNull()
  })
})
