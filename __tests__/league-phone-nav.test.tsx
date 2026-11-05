/**
 * Phone polish (2026-10-25): the native league's bottom tab bar is built from the league's own tabs
 * (a Guilly league gets a Guilly tab, a tab the league lacks is never drawn), More opens the full
 * league menu in place of the old hamburger and section dropdown, and "More tools" leaves out the
 * tabs that duplicate a screen already in the menu.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildNativeLeagueNavigation, nativeLeagueBottomTabs } from '@/lib/league/nativeLeagueNavigation'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'

const tab = (id: string) => ({ id, label: id })

// The tab list LeagueShell builds for a native NBA Guilly league, commissioner's view.
const NBA_GUILLY = [
  'native_home', 'decide', 'draft_intel', 'roster', 'redraft', 'guillotine', 'team', 'matchups', 'league', 'players', 'waivers',
  'standings', 'trades', 'scores', 'finance', 'war_room', 'ai_coaching', 'history', 'league_chat', 'commissioner', 'draft', 'settings', 'legacy',
].map(tab)

const ids = (rows: Array<{ id: string }>) => rows.map(row => row.id)
const moreOf = (groups: ReturnType<typeof buildNativeLeagueNavigation>) => groups.find(group => group.title === 'More tools')?.items ?? []

describe('More tools', () => {
  it('leaves out tabs that are another screen in the menu, and keeps every distinct tool', () => {
    const more = moreOf(buildNativeLeagueNavigation(NBA_GUILLY, true))
    expect(ids(more)).toEqual(['league', 'players', 'finance', 'ai_coaching', 'history', 'commissioner', 'legacy'])
    for (const dropped of ['team', 'redraft', 'draft_intel']) expect(ids(more)).not.toContain(dropped)
  })

  it('gives the rows plain names', () => {
    const more = moreOf(buildNativeLeagueNavigation(NBA_GUILLY, true))
    expect(more.map(row => row.label)).toEqual(['League overview', 'Player research', 'League dues', 'Chimmy coaching', 'Past seasons', 'Commissioner hub', 'League history'])
  })

  it('keeps My Team as a tool when the league has no roster tab to stand in for it', () => {
    const groups = buildNativeLeagueNavigation(['native_home', 'team', 'league_chat'].map(tab), false)
    expect(ids(groups.flatMap(group => group.items))).toContain('team')
  })

  it('hides the commissioner hub from members', () => {
    expect(ids(moreOf(buildNativeLeagueNavigation(NBA_GUILLY, false)))).not.toContain('commissioner')
  })
})

describe('nativeLeagueBottomTabs', () => {
  const bottom = (tabs: Array<{ id: string; label: string }>, phase: string, survivor = false) =>
    nativeLeagueBottomTabs(buildNativeLeagueNavigation(tabs, true, survivor), phase)

  it('a Guilly league in season: League, Guilly, Team, Players, Chat', () => {
    const tabs = bottom(NBA_GUILLY, 'Regular season')
    expect(ids(tabs)).toEqual(['native_home', 'guillotine', 'roster', 'waivers', 'league_chat'])
    expect(tabs.map(row => row.label)).toEqual(['League', 'Guilly', 'Team', 'Players', 'Chat'])
  })

  it('Draft takes the second slot before and during the draft', () => {
    for (const phase of ['Setup', 'Draft']) expect(bottom(NBA_GUILLY, phase)[1]).toMatchObject({ id: 'draft', label: 'Draft' })
  })

  it('a plain league shows Matchup; a Survivor league shows the Island', () => {
    const plain = NBA_GUILLY.filter(row => row.id !== 'guillotine')
    expect(bottom(plain, 'Playoffs')[1]).toMatchObject({ id: 'matchups', label: 'Matchup' })
    const survivor = [...plain, tab('survivor'), tab('survivor_tribal')]
    expect(bottom(survivor, 'Regular season', true)[1]).toMatchObject({ id: 'survivor', label: 'Island' })
  })

  it('never draws a tab the league does not have', () => {
    expect(ids(bottom(['native_home', 'players', 'league_chat'].map(tab), 'Regular season'))).toEqual(['native_home', 'players', 'league_chat'])
  })
})

function stubMatchMedia() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

const league = {
  id: 'g1', name: 'Blade Runners', platform: 'allfantasy', sport: 'NBA', season: 2026, teamCount: 4, format: 'Guilly',
  scoring: 'Points', currentWeek: 3, lifecycleState: 'in_season', leagueVariant: 'guillotine', guillotineMode: true,
} as never

function renderWorkspace(activeTab: string, onSelectTab = vi.fn()) {
  render(
    <NativeLeagueWorkspace native league={league} leagues={[league]} tabs={NBA_GUILLY} activeTab={activeTab} isCommissioner onSelectTab={onSelectTab} onOpenSettings={() => {}} leftPanel={null} rightPanel={null}>
      <div>tab</div>
    </NativeLeagueWorkspace>,
  )
  return onSelectTab
}

describe('phone bottom bar', () => {
  beforeEach(() => {
    stubMatchMedia()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    HTMLDialogElement.prototype.showModal ??= function () {}
    HTMLDialogElement.prototype.close ??= function () {}
  })
  afterEach(() => vi.unstubAllGlobals())

  it('draws the league\'s tabs plus More, and marks the open one', () => {
    renderWorkspace('guillotine')
    const nav = screen.getByTestId('nl-bottom-nav')
    expect([...nav.querySelectorAll('button')].map(button => button.textContent)).toEqual(['League', 'Guilly', 'Team', 'Players', 'Chat', 'More'])
    expect(screen.getByTestId('nl-bottom-tab-guillotine').getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('nl-bottom-more').getAttribute('aria-current')).toBeNull()
  })

  it('More is marked when the open screen lives in the menu', () => {
    renderWorkspace('finance')
    expect(screen.getByTestId('nl-bottom-more').getAttribute('aria-current')).toBe('page')
  })

  it('More opens the league menu and a pick closes it', () => {
    const onSelectTab = renderWorkspace('native_home')
    const more = screen.getByTestId('nl-bottom-more')
    const menu = document.getElementById('nl-league-menu')!
    expect(more.getAttribute('aria-controls')).toBe('nl-league-menu')
    expect(menu.className).not.toContain('nl-menu-open')
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(menu.className).toContain('nl-menu-open')
    fireEvent.click(screen.getByRole('button', { name: 'League dues' }))
    expect(onSelectTab).toHaveBeenCalledWith('finance')
    expect(menu.className).not.toContain('nl-menu-open')
  })

  it('a bottom tab selects its screen', () => {
    const onSelectTab = renderWorkspace('native_home')
    fireEvent.click(screen.getByTestId('nl-bottom-tab-waivers'))
    expect(onSelectTab).toHaveBeenCalledWith('waivers')
  })

  it('the phone no longer carries a second and third copy of the menu', () => {
    renderWorkspace('native_home')
    expect(screen.queryByRole('combobox', { name: 'League section' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open league navigation' })).toBeNull()
  })
})
