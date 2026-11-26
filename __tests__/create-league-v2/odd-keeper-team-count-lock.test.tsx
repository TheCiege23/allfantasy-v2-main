import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_V2_STATE } from '@/lib/create-league-v2/state'
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/create-league-v2/CreateLeagueVideoTile', () => ({ CreateLeagueVideoTile: ({ testId, onSelect }: { testId: string; onSelect: () => void }) => <button data-testid={testId} onClick={onSelect}>Select</button> }))
import { LeagueBasicsStep } from '@/components/create-league-v2/CreateLeagueWizard'

const keeper = { ...DEFAULT_V2_STATE, leagueType: 'keeper' as const, teamCount: 12, sport: 'NFL' as const }

describe('odd keeper sizes in the create wizard', () => {
  it('without AF Commissioner: the stepper walks even sizes and the odd ones are shown locked', () => {
    render(<LeagueBasicsStep state={keeper} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.getByTestId('g30-team-count')).toHaveAttribute('step', '2')
    expect(screen.getByTestId('g30-team-count')).toHaveAttribute('max', '20')
    expect(document.getElementById('g30-team-count-options')).toHaveTextContent('4, 6, 8, 10, 12, 14, 16, 18, 20')
    expect(screen.getByTestId('g30-team-count-locked')).toHaveTextContent('Odd sizes (5, 7, 9, 11, 13, 15, 17, 19) are part of AF Commissioner.')
    const upgrade = new URL(screen.getByTestId('g30-team-count-upgrade').getAttribute('href')!, window.location.origin)
    expect(upgrade.pathname).toBe('/upgrade')
    expect(upgrade.searchParams.get('plan')).toBe('commissioner')
    expect(upgrade.searchParams.get('offer')).toBe('monthly')
    expect(upgrade.searchParams.get('from')).toBe('lock_league_creation_team_count')
  })

  it('with AF Commissioner: every size from 4 to 20, nothing locked', () => {
    render(<LeagueBasicsStep state={keeper} onChange={vi.fn()} fieldErrors={null} hasCommissioner />)
    expect(screen.getByTestId('g30-team-count')).toHaveAttribute('step', '1')
    expect(screen.queryByTestId('g30-team-count-locked')).toBeNull()
    expect(document.getElementById('g30-team-count-options')).toHaveTextContent('4 to 20')
  })

  it('redraft odd sizes are AF Commissioner too (owner, 2026-11-25), with the same upgrade link', () => {
    render(<LeagueBasicsStep state={{ ...keeper, leagueType: 'redraft' }} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.getByTestId('g30-team-count')).toHaveAttribute('step', '2')
    expect(screen.getByTestId('g30-team-count-locked')).toHaveTextContent(/Odd sizes \(3, 5, 7…\) are part of AF Commissioner\./)
    expect(screen.getByTestId('g30-team-count-upgrade').getAttribute('href')).toContain('plan=commissioner')
  })

  it('redraft with AF Commissioner: odd sizes open, nothing locked', () => {
    render(<LeagueBasicsStep state={{ ...keeper, leagueType: 'redraft' }} onChange={vi.fn()} fieldErrors={null} hasCommissioner />)
    expect(screen.queryByTestId('g30-team-count-locked')).toBeNull()
    expect(screen.getByTestId('g30-team-count')).toHaveAttribute('step', '1')
  })

  it('picking an odd size turns league median on; back to even turns it off', () => {
    const onChange = vi.fn()
    const view = render(<LeagueBasicsStep state={{ ...keeper, leagueType: 'redraft' }} onChange={onChange} fieldErrors={null} hasCommissioner />)
    fireEvent.change(screen.getByTestId('g30-team-count'), { target: { value: '11' } })
    expect(onChange.mock.calls[0]![0]).toMatchObject({ teamCount: 11, medianGame: true })
    view.rerender(<LeagueBasicsStep state={{ ...keeper, leagueType: 'redraft', teamCount: 11, medianGame: true }} onChange={onChange} fieldErrors={null} hasCommissioner />)
    fireEvent.change(screen.getByTestId('g30-team-count'), { target: { value: '9' } })
    expect(onChange.mock.calls[1]![0]).not.toHaveProperty('medianGame')
    fireEvent.change(screen.getByTestId('g30-team-count'), { target: { value: '10' } })
    expect(onChange.mock.calls[2]![0]).toMatchObject({ teamCount: 10, medianGame: false })
  })
})
