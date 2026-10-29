import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({
  CreateLeagueVideoTile: ({ testId, title }: { testId: string; title: string }) => <button data-testid={testId}>{title}</button>,
}))

import { RosterLabel, RulesLabelPicker, ScoringLabel } from '@/components/league-labels'
import { DraftStep } from '@/components/create-league-v2/CreateLeagueWizard'

describe('ScoringLabel', () => {
  it('md shows the plate with an accessible alt, the name and the one-liner', () => {
    render(<ScoringLabel id="half" size="md" />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('/labels/scoring/half.svg')
    expect(img.getAttribute('alt')).toBe('Half PPR scoring: 0.5 per catch')
    expect(screen.getByText('Half PPR')).toBeTruthy()
  })

  it('sm draws the pill in code, without the plate image', () => {
    render(<ScoringLabel id="cat9" size="sm" />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByTestId('scoring-pill-cat9').textContent).toBe('9CAT')
  })

  it('custom always reads CUSTOM; unknown ids render nothing', () => {
    const { container } = render(<><ScoringLabel id="custom" size="sm" /><ScoringLabel id="espn_ppr" /></>)
    expect(screen.getByTestId('scoring-pill-custom').textContent).toBe('CUSTOM')
    expect(container.querySelectorAll('[data-testid^="scoring-label-"]').length).toBe(1)
  })
})

describe('RosterLabel', () => {
  it('uses the strip art only when bench and IR match the design', () => {
    const { rerender } = render(<RosterLabel id="nfl-std" size="lg" />)
    expect(screen.getByRole('img').getAttribute('src')).toBe('/labels/roster/nfl-std.svg')
    rerender(<RosterLabel id="nfl-std" size="lg" bench={6} injured={1} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('BN ×6')).toBeTruthy()
    expect(screen.getByText('Standard roster · 9 start · 15 slots')).toBeTruthy()
  })
})

describe('RulesLabelPicker', () => {
  it('is a single-choice radio group that reports the picked id', () => {
    const onChange = vi.fn()
    render(<RulesLabelPicker kind="scoring" legend="Scoring" options={[{ id: 'half' }, { id: 'ppr' }]} value="half" onChange={onChange} />)
    expect(screen.getByTestId('rules-label-option-half').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByTestId('rules-label-option-ppr'))
    expect(onChange).toHaveBeenCalledWith('ppr')
  })

  it('locked: every option is disabled and the reason is shown', () => {
    const onChange = vi.fn()
    render(<RulesLabelPicker kind="roster" legend="Roster" options={[{ id: 'nfl-std' }, { id: 'nfl-sf' }]} value="nfl-std" onChange={onChange} locked />)
    fireEvent.click(screen.getByTestId('rules-label-option-nfl-sf'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('Locked once registration opens.')).toBeTruthy()
  })
})

describe('league creation shows the chosen scoring label', () => {
  const base = { ...DEFAULT_V2_STATE, sport: 'NFL' as const, leagueType: 'redraft' as const, draftType: 'snake' as const }

  it('Half PPR by default, TE+ for Full PPR with 0.5 TE premium', () => {
    const { rerender } = render(<DraftStep state={{ ...base, scoringPresetId: 'fb_half_ppr' }} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.getByTestId('scoring-label-half')).toBeTruthy()
    rerender(<DraftStep state={{ ...base, scoringPresetId: 'fb_full_ppr', tePremium: true, tePremiumPoints: 0.5 }} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.getByTestId('scoring-label-te')).toBeTruthy()
  })
})
