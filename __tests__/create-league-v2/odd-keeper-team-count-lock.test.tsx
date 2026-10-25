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
    expect(screen.getByTestId('g30-team-count-upgrade')).toHaveAttribute('href', '/pricing?plan=commissioner')
  })

  it('with AF Commissioner: every size from 4 to 20, nothing locked', () => {
    render(<LeagueBasicsStep state={keeper} onChange={vi.fn()} fieldErrors={null} hasCommissioner />)
    expect(screen.getByTestId('g30-team-count')).toHaveAttribute('step', '1')
    expect(screen.queryByTestId('g30-team-count-locked')).toBeNull()
    expect(document.getElementById('g30-team-count-options')).toHaveTextContent('4 to 20')
  })

  it('redraft shows no lock — its odd sizes are free', () => {
    render(<LeagueBasicsStep state={{ ...keeper, leagueType: 'redraft' }} onChange={vi.fn()} fieldErrors={null} />)
    expect(screen.queryByTestId('g30-team-count-locked')).toBeNull()
  })

  it('picking an odd size turns league median on; back to even turns it off', () => {
    const onChange = vi.fn()
    const view = render(<LeagueBasicsStep state={{ ...keeper, leagueType: 'redraft' }} onChange={onChange} fieldErrors={null} />)
    fireEvent.change(screen.getByTestId('g30-team-count'), { target: { value: '11' } })
    expect(onChange.mock.calls[0]![0]).toMatchObject({ teamCount: 11, medianGame: true })
    view.rerender(<LeagueBasicsStep state={{ ...keeper, leagueType: 'redraft', teamCount: 11, medianGame: true }} onChange={onChange} fieldErrors={null} />)
    fireEvent.change(screen.getByTestId('g30-team-count'), { target: { value: '9' } })
    expect(onChange.mock.calls[1]![0]).not.toHaveProperty('medianGame')
    fireEvent.change(screen.getByTestId('g30-team-count'), { target: { value: '10' } })
    expect(onChange.mock.calls[2]![0]).toMatchObject({ teamCount: 10, medianGame: false })
  })
})
