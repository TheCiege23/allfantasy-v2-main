import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({ CreateLeagueVideoTile: ({ testId, onSelect }: { testId: string; onSelect: () => void }) => <button data-testid={testId} onClick={onSelect}>Select</button> }))
import { LeagueBasicsStep } from '@/components/create-league-v2/CreateLeagueWizard'

describe('simple creation team choices agree with the server', () => {
  it.each(['dynasty', 'keeper', 'best_ball'])('normalizes a two-team redraft when switching to %s', (concept) => {
    const onChange = vi.fn()
    const state = { ...DEFAULT_V2_STATE, leagueType: 'redraft' as const, teamCount: 2, sport: 'NFL' as const }
    const view = render(<LeagueBasicsStep state={state} onChange={onChange} fieldErrors={null} />)
    fireEvent.click(screen.getByTestId('g30-league-type-' + concept))
    const next = { ...state, ...onChange.mock.calls[0][0] }
    expect(next.teamCount).toBe(12)
    view.rerender(<LeagueBasicsStep state={next} onChange={onChange} fieldErrors={null} />)
    const count = screen.getByTestId('g30-team-count')
    expect(count).toHaveAttribute('min', '8')
    expect(count).toHaveAttribute('max', '16')
    expect(count).toHaveAttribute('step', '2')
    expect(document.getElementById('g30-team-count-options')).toHaveTextContent('8, 10, 12, 14, 16')
    for (const teamCount of [8, 10, 12, 14, 16]) {
      const validation = validateCreatePayload({ concept, sport: next.sport, teamCount, draftType: next.draftType, scoringPreset: next.scoringPresetId, leagueName: 'Accepted choices' })
      expect(validation.ok, JSON.stringify(validation)).toBe(true)
    }
  })
  it('preserves the full redraft range and a valid existing selection', () => {
    const onChange = vi.fn()
    const state = { ...DEFAULT_V2_STATE, leagueType: 'redraft' as const, teamCount: 32, sport: 'NFL' as const }
    render(<LeagueBasicsStep state={state} onChange={onChange} fieldErrors={null} />)
    const count = screen.getByTestId('g30-team-count')
    expect(count).toHaveAttribute('min', '2')
    expect(count).toHaveAttribute('max', '32')
    expect(count).toHaveAttribute('step', '1')
    fireEvent.click(screen.getByTestId('g30-league-type-redraft'))
    expect(onChange.mock.calls[0][0].teamCount).toBe(32)
  })
})
