import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CommissionerOperationsWorkspace } from '@/components/league-home/CommissionerOperationsWorkspace'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/components/decide/CommissionerPulse', () => ({ CommissionerPulse: () => null }))

const league = { id: 'league-1', name: 'Blah', platform: 'manual', lifecycleState: 'setup' } as UserLeague
function workspace(isCommissioner = true) {
  const onOpenSettings = vi.fn(), onOpenTab = vi.fn()
  render(<CommissionerOperationsWorkspace league={league} leagueId={league.id} isCommissioner={isCommissioner} isOwner={true} hasActiveRedraftSeason={false} onOpenSettings={onOpenSettings} onOpenTab={onOpenTab} />)
  return { onOpenSettings, onOpenTab }
}

describe('Commissioner Hub navigation', () => {
  it('every section shortcut reaches a named section in this workspace', () => {
    workspace()
    const nav = screen.getByRole('navigation', { name: 'Commissioner sections' })
    const links = nav.querySelectorAll('a')
    expect(links.length).toBeGreaterThan(3)
    for (const link of links) {
      const target = document.getElementById(link.hash.slice(1))
      expect(target).not.toBeNull()
      expect(target).toHaveAccessibleName(link.textContent!)
    }
  })
  it('keeps existing settings and transaction destinations', () => {
    const { onOpenSettings, onOpenTab } = workspace()
    fireEvent.click(screen.getByTestId('commissioner-operation-trade-settings'))
    expect(onOpenSettings).toHaveBeenCalledWith('trade')
    fireEvent.click(screen.getByTestId('commissioner-operation-waiver-operations'))
    expect(onOpenTab).toHaveBeenCalledWith('waivers')
    expect(screen.getByTestId('commissioner-operation-advance-week')).toBeDisabled()
  })
  it('does not expose commissioner navigation to a manager', () => {
    workspace(false)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Commissioner sections' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('commissioner-operation-trade-settings')).not.toBeInTheDocument()
  })
})
