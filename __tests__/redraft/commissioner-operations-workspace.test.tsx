import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommissionerOperationsWorkspace } from '@/components/league-home/CommissionerOperationsWorkspace'

const league = {
  id: 'league-g47',
  name: 'G47 Redraft',
  sport: 'NFL',
  leagueType: 'redraft',
  lifecycleState: 'regular_season',
  currentWeek: 4,
} as never

describe('CommissionerOperationsWorkspace', () => {
  it('renders grouped operations without duplicating League Home', () => {
    render(<CommissionerOperationsWorkspace league={league} leagueId="league-g47" isCommissioner hasActiveRedraftSeason onOpenSettings={vi.fn()} onOpenTab={vi.fn()} />)
    expect(screen.getByTestId('commissioner-operations-workspace')).toHaveAttribute('data-league-id', 'league-g47')
    for (const group of ['league-operations', 'league-settings', 'transactions', 'draft', 'members', 'communication']) {
      expect(screen.getByTestId(`commissioner-group-${group}`)).toBeInTheDocument()
    }
    expect(screen.queryByText('Monitor league health, trade health, waiver activity, draft readiness, and manager engagement.')).not.toBeInTheDocument()
  })

  it('routes cards to existing canonical tabs and settings panels', () => {
    const onOpenSettings = vi.fn()
    const onOpenTab = vi.fn()
    render(<CommissionerOperationsWorkspace league={league} leagueId="league-g47" isCommissioner hasActiveRedraftSeason onOpenSettings={onOpenSettings} onOpenTab={onOpenTab} />)
    fireEvent.click(screen.getByTestId('commissioner-operation-schedule'))
    fireEvent.click(screen.getByTestId('commissioner-operation-waiver-operations'))
    fireEvent.click(screen.getByTestId('commissioner-operation-league-controls'))
    expect(onOpenTab).toHaveBeenCalledWith('schedule')
    expect(onOpenTab).toHaveBeenCalledWith('waivers')
    expect(onOpenSettings).toHaveBeenCalledWith('commish-controls')
  })

  it('blocks privileged operations for non-commissioners', () => {
    render(<CommissionerOperationsWorkspace league={league} leagueId="league-g47" isCommissioner={false} hasActiveRedraftSeason onOpenSettings={vi.fn()} onOpenTab={vi.fn()} />)
    expect(screen.getByTestId('commissioner-operations-denied')).toHaveAttribute('role', 'alert')
    expect(screen.queryByTestId('commissioner-operations-workspace')).not.toBeInTheDocument()
  })

  it('shows unavailable week advancement truthfully', () => {
    render(<CommissionerOperationsWorkspace league={league} leagueId="league-g47" isCommissioner hasActiveRedraftSeason onOpenSettings={vi.fn()} onOpenTab={vi.fn()} />)
    expect(screen.getByTestId('commissioner-operation-advance-week')).toBeDisabled()
    expect(screen.getByTestId('commissioner-operation-advance-week')).toHaveTextContent('Not available yet')
  })
})
