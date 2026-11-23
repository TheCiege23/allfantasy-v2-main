/**
 * The member gear menu for an imported league (2026-11-22). Imported leagues lost the old league header's member menu
 * (Edit team, Co-owners, Leave league, Previous leagues) when they moved into the workspace; the workspace header now
 * carries it. Without a menu (a commissioner, or any native league) the gear goes straight to settings, as before.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'

const league = { id: 'imp1', name: 'Road To Glory', platform: 'fantrax', sport: 'NCAAF', season: 2026, teamCount: 140, format: 'dynasty', scoring: 'College', currentWeek: 12, lifecycleState: 'in_season' } as never
const tabs = ['native_home', 'decide', 'roster', 'matchups', 'standings', 'trades', 'settings'].map((id) => ({ id, label: id }))

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  HTMLDialogElement.prototype.showModal ??= function () {}
  HTMLDialogElement.prototype.close ??= function () {}
  localStorage.clear()
  window.history.replaceState(null, '', '/league/imp1')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderWorkspace(memberMenu: Array<{ id: string; title: string; sub: string; onSelect: () => void }> | null, onOpenSettings = vi.fn()) {
  render(
    <NativeLeagueWorkspace native={false} league={league} leagues={[league]} tabs={tabs} activeTab="native_home" isCommissioner={memberMenu == null}
      onSelectTab={() => {}} onOpenSettings={onOpenSettings} memberMenu={memberMenu} leftPanel={null} rightPanel={null}>
      <div>screen</div>
    </NativeLeagueWorkspace>,
  )
  return onOpenSettings
}

const items = () => {
  const picks = { 'edit-team': vi.fn(), 'co-owners': vi.fn(), leave: vi.fn(), previous: vi.fn() }
  const menu = [
    { id: 'edit-team', title: 'Edit Team', sub: 'Customize your team', onSelect: picks['edit-team'] },
    { id: 'co-owners', title: 'Co-owner Settings', sub: 'Select co-owners to run your team', onSelect: picks['co-owners'] },
    { id: 'leave', title: 'Leave League', sub: 'Leave this league.', onSelect: picks.leave },
    { id: 'previous', title: 'Previous Leagues', sub: 'Look at previous leagues', onSelect: picks.previous },
  ]
  return { menu, picks }
}

describe('member gear menu on an imported league', () => {
  it('the gear opens the four member items; picking one runs it and closes the menu', () => {
    const { menu, picks } = items()
    const onOpenSettings = renderWorkspace(menu)
    const gear = screen.getByTestId('workspace-member-gear')
    expect(gear.getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.queryByTestId('member-league-gear-menu')).toBeNull()

    fireEvent.click(gear)
    expect(gear.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByRole('menuitem').map((b) => b.querySelector('strong')?.textContent)).toEqual(['Edit Team', 'Co-owner Settings', 'Leave League', 'Previous Leagues'])

    fireEvent.click(screen.getByTestId('member-gear-co-owners'))
    expect(picks['co-owners']).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('member-league-gear-menu')).toBeNull()
    expect(onOpenSettings).not.toHaveBeenCalled()
  })

  it('Escape and a click outside close it', () => {
    renderWorkspace(items().menu)
    fireEvent.click(screen.getByTestId('workspace-member-gear'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('member-league-gear-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('workspace-member-gear'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('member-league-gear-menu')).toBeNull()
  })

  it('without a menu (a commissioner) the gear opens settings directly', () => {
    const onOpenSettings = renderWorkspace(null)
    expect(screen.queryByTestId('workspace-member-gear')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'League settings' })[0])
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})
