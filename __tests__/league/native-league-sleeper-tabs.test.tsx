/**
 * The league sidebar as Sleeper's six tabs (owner, 2026-11-17 and 2026-11-19: "Sleeper's six only"), and switching league
 * or coming back keeping the page you were on (2026-11-19: "if I choose another league, the same page I'm on … should
 * show on the next league. If I leave a tab, it shouldn't reset").
 */
import React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeLeagueWorkspace } from '@/components/league/native/NativeLeagueWorkspace'
import { buildNativeLeagueNavigation, leagueSectionHref, nativeNavLeafIds, nativeNavTabFor } from '@/lib/league/nativeLeagueNavigation'
import { leagueSwitchHref } from '@/lib/league/leagueSwitchHref'

/** The NFL redraft core tab list a native commissioner gets (LeagueShell `nflRedraftCore`). */
const CORE = ['native_home', 'home', 'decide', 'ai_coaching', 'draft', 'draft_intel', 'roster', 'matchups', 'schedule', 'players', 'waivers', 'trades', 'standings', 'legacy', 'war_room', 'league_chat', 'activity', 'news', 'commissioner', 'settings']
  .map(id => ({ id, label: id }))

describe('Sleeper tabs', () => {
  const groups = buildNativeLeagueNavigation(CORE, true)
  const tabs = groups[0].items

  it('the 21-item sidebar is the six tabs, plus Draft before the draft is done', () => {
    expect(groups.map(g => g.id)).toEqual(['league'])
    expect(tabs.map(t => t.label)).toEqual(['Draft', 'Matchup', 'Team', 'League', 'Trade', 'News', 'Settings'])
    expect(Object.fromEntries(tabs.map(t => [t.label, t.children.map(c => c.label)]))).toEqual({
      Draft: ['Draft HQ'],
      Matchup: ['Matchup', 'Schedule', 'War Room'],
      Team: ['My team', 'Players & waivers', 'Player search', 'Chimmy Coaching'],
      League: ['Overview', 'Standings & playoffs', 'Activity', 'League chat', 'Legacy'],
      Trade: ['Trades', 'Decision OS'],
      News: ['News', 'Live Intel'],
      Settings: ['League settings', 'Commissioner tools'],
    })
  })

  it('every tab the league has is still reachable, under exactly one top tab', () => {
    const leaves = nativeNavLeafIds(groups)
    // `home` is the core page, not this league's; native_home is its League home.
    expect([...leaves].sort()).toEqual(CORE.map(t => t.id).filter(id => id !== 'home').sort())
    expect(new Set(leaves).size).toBe(leaves.length)
  })

  it('a top tab opens its first sub-tab, and a sub-tab finds its top tab', () => {
    expect(tabs.map(t => t.id)).toEqual(['draft', 'matchups', 'roster', 'native_home', 'trades', 'news', 'settings'])
    expect(nativeNavTabFor(groups, 'waivers')?.label).toBe('Team')
    expect(nativeNavTabFor(groups, 'decide')?.label).toBe('Trade')
    expect(nativeNavTabFor(groups, 'nope')).toBeNull()
  })

  it('after the draft, Draft HQ moves under League and Draft is no longer a tab', () => {
    const after = buildNativeLeagueNavigation(CORE, true, false, undefined, { draftDone: true })[0].items
    expect(after.map(t => t.label)).toEqual(['Matchup', 'Team', 'League', 'Trade', 'News', 'Settings'])
    expect(after.find(t => t.label === 'League')?.children.map(c => c.id)).toContain('draft')
  })

  it('a member gets the read-only League settings and no commissioner tools', () => {
    const member = buildNativeLeagueNavigation(CORE.filter(t => t.id !== 'commissioner'), false)[0].items
    expect(member.find(t => t.label === 'Settings')?.children.map(c => c.id)).toEqual(['settings'])
  })

  it('a tab nothing places (a format screen such as the Pirate Deck) lands under League, not lost', () => {
    const groupsWithPirate = buildNativeLeagueNavigation([...CORE, { id: 'pirate', label: 'Pirate Deck' }], true)
    expect(nativeNavTabFor(groupsWithPirate, 'pirate')?.label).toBe('League')
  })
})

describe('switching league keeps the page', () => {
  const nativeRow = { id: 'n 1', platform: 'allfantasy' }
  const importedRow = { id: 'i1', platform: 'sleeper' }

  it('native → native keeps the tab', () => {
    expect(leagueSwitchHref(nativeRow, { view: 'trades' })).toBe('/league/n%201?view=trades')
  })
  it('native → imported opens the matching /core screen', () => {
    expect(leagueSwitchHref(importedRow, { view: 'trades' })).toBe('/core/trades?league=i1')
    expect(leagueSwitchHref(importedRow, { view: 'roster' })).toBe('/core/my-team?league=i1')
    expect(leagueSwitchHref(importedRow, { view: 'matchups' })).toBe('/core/matchup?league=i1')
  })
  it('imported → native opens the matching tab', () => {
    expect(leagueSwitchHref(nativeRow, { coreScreen: 'my-team' })).toBe('/league/n%201?view=roster')
    expect(leagueSwitchHref(nativeRow, { coreScreen: 'trades' })).toBe('/league/n%201?view=trades')
  })
  it('imported → imported keeps the screen', () => {
    expect(leagueSwitchHref(importedRow, { coreScreen: 'standings' })).toBe('/core/standings?league=i1')
  })
  it('a page with no counterpart opens the league front page, as before', () => {
    expect(leagueSwitchHref(importedRow, { view: 'native_home' })).toBe('/core?league=i1')
    expect(leagueSwitchHref(importedRow, { view: 'bb_hoh' })).toBe('/core?league=i1')
    expect(leagueSwitchHref(importedRow, { coreScreen: 'my-leagues' })).toBe('/core?league=i1')
    expect(leagueSwitchHref(nativeRow, { coreScreen: 'my-leagues' })).toBe('/league/n%201')
    expect(leagueSwitchHref(nativeRow, null)).toBe('/league/n%201')
  })
  it('the native rail link uses it for an imported row too (it used to drop the page)', () => {
    expect(leagueSectionHref({ id: 'i1', platform: 'sleeper', name: 'x' } as never, 'trades')).toBe('/core/trades?league=i1')
    expect(leagueSectionHref({ id: 'n1', platform: 'allfantasy', name: 'x' } as never, 'trades')).toBe('/league/n1?view=trades')
  })
})

const league = { id: 'lg1', name: 'Keepers', platform: 'allfantasy', sport: 'NFL', season: 2026, teamCount: 12, format: 'redraft', scoring: 'PPR', currentWeek: 8, lifecycleState: 'in_season', leagueVariant: 'redraft', leagueType: 'redraft' } as never

function workspace(tabs: { id: string; label: string }[], activeTab: string, onSelectTab = vi.fn()) {
  return (
    <NativeLeagueWorkspace native league={league} leagues={[league]} tabs={tabs} activeTab={activeTab} isCommissioner onSelectTab={onSelectTab} onOpenSettings={() => {}} leftPanel={null} rightPanel={null}>
      <div>screen</div>
    </NativeLeagueWorkspace>
  )
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
  HTMLDialogElement.prototype.showModal ??= function () {}
  HTMLDialogElement.prototype.close ??= function () {}
  localStorage.clear()
  window.history.replaceState(null, '', '/league/lg1')
})
afterEach(() => vi.unstubAllGlobals())

describe('the sidebar and sub-tabs, rendered', () => {
  it('draws the six tabs and the open tab\'s sub-tabs as a strip above the screen', () => {
    const { container } = render(workspace(CORE, 'waivers'))
    const sidebar = [...container.querySelectorAll('.nl-sidebar [data-nav-group=league] button')]
    expect(sidebar.map(b => b.textContent)).toEqual(['Matchup', 'Team', 'League', 'Trade', 'News', 'Settings'])
    expect(sidebar.find(b => b.textContent === 'Team')?.getAttribute('aria-current')).toBe('page')
    const strip = [...container.querySelectorAll('[data-testid=nl-subtabs] button')]
    expect(strip.map(b => b.getAttribute('data-subtab'))).toEqual(['roster', 'waivers', 'players', 'ai_coaching'])
    expect(strip.find(b => b.getAttribute('data-subtab') === 'waivers')?.getAttribute('aria-current')).toBe('page')
  })

  it('a top tab reopens the sub-tab last opened under it', () => {
    const onSelectTab = vi.fn()
    const { container, rerender } = render(workspace(CORE, 'decide', onSelectTab))
    rerender(workspace(CORE, 'roster', onSelectTab))
    onSelectTab.mockClear()
    fireEvent.click(container.querySelector('.nl-sidebar [data-nav-tab=trades]')!)
    expect(onSelectTab).toHaveBeenLastCalledWith('decide')
  })
})

describe('coming back to a league reopens the last tab', () => {
  const memory = 'af:league-section:lg1'

  it('waits for a tab that arrives late, and does not save League home over it meanwhile', () => {
    localStorage.setItem(memory, 'settings')
    const onSelectTab = vi.fn()
    const early = CORE.filter(t => t.id !== 'settings' && t.id !== 'commissioner')
    const { rerender } = render(workspace(early, 'native_home', onSelectTab))
    expect(onSelectTab).not.toHaveBeenCalled()
    expect(localStorage.getItem(memory)).toBe('settings')
    rerender(workspace(CORE, 'native_home', onSelectTab))
    expect(onSelectTab).toHaveBeenCalledWith('settings')
  })

  it('a ?view= in the URL wins over the remembered tab', () => {
    localStorage.setItem(memory, 'trades')
    window.history.replaceState(null, '', '/league/lg1?view=standings')
    const onSelectTab = vi.fn()
    render(workspace(CORE, 'standings', onSelectTab))
    expect(onSelectTab).not.toHaveBeenCalled()
    expect(localStorage.getItem(memory)).toBe('standings')
  })

  it('opening another tab ends the wait', () => {
    localStorage.setItem(memory, 'settings')
    const early = CORE.filter(t => t.id !== 'settings' && t.id !== 'commissioner')
    const { rerender } = render(workspace(early, 'native_home'))
    rerender(workspace(early, 'trades'))
    expect(localStorage.getItem(memory)).toBe('trades')
  })
})
