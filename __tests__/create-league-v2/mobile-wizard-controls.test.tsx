/**
 * The phone-first controls added to the create wizard: the team-size steppers (typing a number
 * on a phone keypad and having it refused was the slow path) and the Review step's "Fix" links,
 * which send the manager to the step that owns each blocking issue.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
import { analyzeCreateLeagueCompletion } from '@/lib/create-league-v2/form-completion'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({
  CreateLeagueVideoTile: ({ testId, onSelect }: { testId: string; onSelect: () => void }) => <button data-testid={testId} onClick={onSelect}>Select</button>,
}))

import { LeagueBasicsStep, ReviewCreateStep, stepForIssue } from '@/components/create-league-v2/CreateLeagueWizard'

describe('team-size steppers walk the sizes the format allows', () => {
  it('steps a dynasty league by two and refits its playoff block', () => {
    const onChange = vi.fn()
    const state = { ...DEFAULT_V2_STATE, leagueType: 'dynasty' as const, teamCount: 12, sport: 'NFL' as const }
    render(<LeagueBasicsStep state={state} onChange={onChange} fieldErrors={null} />)
    fireEvent.click(screen.getByTestId('g30-team-count-increase'))
    expect(onChange.mock.calls[0][0].teamCount).toBe(14)
    fireEvent.click(screen.getByTestId('g30-team-count-decrease'))
    const patch = onChange.mock.calls[1][0]
    expect(patch.teamCount).toBe(10)
    expect(patch.dynasty.playoffTeamCount).toBeLessThanOrEqual(10)
  })

  it('snaps a typed off-step size back onto the allowed list', () => {
    const onChange = vi.fn()
    const state = { ...DEFAULT_V2_STATE, leagueType: 'dynasty' as const, teamCount: 7, sport: 'NFL' as const }
    render(<LeagueBasicsStep state={state} onChange={onChange} fieldErrors={null} />)
    fireEvent.click(screen.getByTestId('g30-team-count-increase'))
    expect(onChange.mock.calls[0][0].teamCount).toBe(8)
    fireEvent.click(screen.getByTestId('g30-team-count-decrease'))
    expect(onChange.mock.calls[1][0].teamCount).toBe(6)
  })

  it('disables a stepper at each end of the range', () => {
    const state = { ...DEFAULT_V2_STATE, leagueType: 'redraft' as const, teamCount: 32, sport: 'NFL' as const }
    const view = render(<LeagueBasicsStep state={state} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.getByTestId('g30-team-count-increase')).toBeDisabled()
    expect(screen.getByTestId('g30-team-count-decrease')).toBeEnabled()
    view.rerender(<LeagueBasicsStep state={{ ...state, teamCount: 2 }} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.getByTestId('g30-team-count-decrease')).toBeDisabled()
  })

  it('locks both steppers when an import fixes the team count', () => {
    const state = { ...DEFAULT_V2_STATE, leagueType: 'redraft' as const, teamCount: 12, sport: 'NFL' as const }
    render(<LeagueBasicsStep state={state} onChange={vi.fn()} fieldErrors={null} importCarryover />)
    expect(screen.getByTestId('g30-team-count-increase')).toBeDisabled()
    expect(screen.getByTestId('g30-team-count-decrease')).toBeDisabled()
  })
})

describe('Review sends each issue to the step that fixes it', () => {
  it('maps every completion code the wizard can raise to a step', () => {
    expect(stepForIssue('sport_required')).toBe('sport')
    expect(stepForIssue('league_name_invalid')).toBe('basics')
    expect(stepForIssue('team_count_invalid')).toBe('basics')
    expect(stepForIssue('draft_date_required')).toBe('draft')
    expect(stepForIssue('scoring_invalid')).toBe('draft')
    expect(stepForIssue('keeper_settings')).toBe('draft')
  })

  it('renders a Fix button per issue that reports its code', () => {
    const state = { ...DEFAULT_V2_STATE, leagueType: 'redraft' as const, name: '', draftDate: '', draftTime: '' }
    const issues = analyzeCreateLeagueCompletion(state)
    // Positive control: the default state really is incomplete, or the loop below proves nothing.
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['league_name_invalid', 'draft_date_required']))
    const onFixIssue = vi.fn()
    render(<ReviewCreateStep state={state} completionIssues={issues} submitError={null} onFixIssue={onFixIssue} />)
    fireEvent.click(screen.getByTestId('g30-review-fix-league_name_invalid'))
    fireEvent.click(screen.getByTestId('g30-review-fix-draft_date_required'))
    expect(onFixIssue.mock.calls.map(([code]) => code)).toEqual(['league_name_invalid', 'draft_date_required'])
  })
})
