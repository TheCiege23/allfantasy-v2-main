import { describe, expect, it } from 'vitest'
import { buildNativeLeagueNavigation, nativeLeagueLandingTab, type WorkspaceTab } from '@/lib/league/nativeLeagueNavigation'

const tab = (id: string): WorkspaceTab => ({ id, label: id }) as WorkspaceTab
const redraftTabs = ['native_home', 'draft', 'roster', 'matchups', 'waivers', 'trades', 'standings', 'legacy', 'news', 'settings'].map(tab)

function firstTop(draftDone: boolean, tabs = redraftTabs) {
  return buildNativeLeagueNavigation(tabs, true, false, undefined, { draftDone })[0]?.items[0]?.id ?? null
}

describe('which tab a league opens on (owner, 2026-11-25)', () => {
  it('opens on Draft before the draft and on Matchup after it, when nothing is remembered', () => {
    expect(nativeLeagueLandingTab({ remembered: null, firstTopTabId: firstTop(false), draftDone: false })).toBe('draft')
    expect(nativeLeagueLandingTab({ remembered: null, firstTopTabId: firstTop(true), draftDone: true })).toBe('matchups')
  })

  it('keeps the tab last open in this league', () => {
    expect(nativeLeagueLandingTab({ remembered: 'trades', firstTopTabId: 'matchups', draftDone: true })).toBe('trades')
    expect(nativeLeagueLandingTab({ remembered: 'draft', firstTopTabId: 'draft', draftDone: false })).toBe('draft')
  })

  it('does not reopen the old League overview, or a Draft tab that is gone after the draft', () => {
    for (const remembered of ['native_home', 'home', 'decide', '  ']) {
      expect(nativeLeagueLandingTab({ remembered, firstTopTabId: 'matchups', draftDone: true })).toBe('matchups')
    }
    expect(nativeLeagueLandingTab({ remembered: 'draft', firstTopTabId: 'matchups', draftDone: true })).toBe('matchups')
  })

  it('opens a guillotine league on Chop after the draft', () => {
    const guilly = [...redraftTabs.filter((t) => t.id !== 'matchups'), tab('guillotine')]
    expect(nativeLeagueLandingTab({ remembered: null, firstTopTabId: firstTop(true, guilly), draftDone: true })).toBe('guillotine')
  })
})
