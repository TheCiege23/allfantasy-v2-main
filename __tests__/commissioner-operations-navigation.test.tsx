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
    // A tool that cannot be used is not listed (2026-11-24): "Advance / Finalize Week" was a disabled card saying so.
    expect(screen.queryByTestId('commissioner-operation-advance-week')).toBeNull()
  })
  it('lists each destination once, in plain words, as one row per tool (2026-11-24)', () => {
    workspace()
    // "League Messages" opened the same league chat as "Announcements & Chat".
    expect(screen.queryByTestId('commissioner-operation-league-messages')).toBeNull()
    expect(screen.getByTestId('commissioner-operation-announcements')).toBeTruthy()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/canonical|authoritative|Decision OS|\bexisting\b/i)
    expect(screen.getByTestId('commissioner-operation-schedule').className).not.toMatch(/flex-col|min-h-\[132px\]/)
  })
  it('does not expose commissioner navigation to a manager', () => {
    workspace(false)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Commissioner sections' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('commissioner-operation-trade-settings')).not.toBeInTheDocument()
  })
})
