/**
 * The draft-type tiles are the only draft-type control (2026-10-12). A dropdown under them used to
 * offer the same list again; it was removed, so the scoring preset is the one select left.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({
  CreateLeagueVideoTile: ({ testId, onSelect, title }: { testId: string; onSelect: () => void; title: string }) => (
    <button data-testid={testId} onClick={onSelect}>{title}</button>
  ),
}))

import { DraftStep } from '@/components/create-league-v2/CreateLeagueWizard'

const state = { ...DEFAULT_V2_STATE, sport: 'NFL' as const, leagueType: 'redraft' as const, scoringPresetId: 'fb_half_ppr', draftType: 'snake' as const }

describe('draft type is chosen with tiles only', () => {
  it('the scoring preset is the only select on the Draft step', () => {
    const { container } = render(<DraftStep state={state} onChange={vi.fn()} fieldErrors={null} />)
    const selects = [...container.querySelectorAll('select')].map((s) => s.getAttribute('data-testid'))
    expect(selects).toEqual(['g30-scoring-preset', 'g30-timezone'])
    expect(screen.queryByTestId('g30-draft-type')).toBeNull()
  })

  it('each tile sets the draft type', () => {
    const onChange = vi.fn()
    render(<DraftStep state={state} onChange={onChange} fieldErrors={null} />)
    fireEvent.click(screen.getByTestId('g31-draft-type-linear'))
    fireEvent.click(screen.getByTestId('g31-draft-type-auction'))
    expect(onChange.mock.calls.map(([patch]) => patch.draftType)).toEqual(['linear', 'auction'])
  })

  it('a server draft-type error is shown under the tiles', () => {
    render(<DraftStep state={state} onChange={vi.fn()} fieldErrors={{ draftType: 'Pick a draft type this format allows.' }} />)
    expect(screen.getByRole('alert').textContent).toBe('Pick a draft type this format allows.')
  })
})
