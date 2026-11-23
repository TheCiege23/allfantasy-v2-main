/**
 * Pirate leagues: the Pirate Deck is its own top tab (2026-11-22, pirate audit item 2).
 *
 * LeagueShell adds a `pirate` tab to every pirate league and opens the league on it, but the navigation had no
 * place for it, so it fell to the END of League's sub-tabs, after Legacy: the sidebar highlighted "League" and a
 * phone's sub-tab row cut it off. It now leads "This league", with an anchor, and League keeps only its own pages.
 */
import { describe, expect, it } from 'vitest'
import { buildNativeLeagueNavigation } from '@/lib/league/nativeLeagueNavigation'

const BASE = [
  { id: 'native_home', label: 'League home' }, { id: 'matchups', label: 'Matchups' }, { id: 'schedule', label: 'Schedule' },
  { id: 'roster', label: 'My Team' }, { id: 'waivers', label: 'Waivers' }, { id: 'trades', label: 'Trades' },
  { id: 'standings', label: 'Standings' }, { id: 'legacy', label: 'Legacy' }, { id: 'war_room', label: 'War Room' },
  { id: 'league_chat', label: 'League Chat' }, { id: 'activity', label: 'Activity' }, { id: 'settings', label: 'Settings' },
]
const thisLeague = (tabs: { id: string; label: string }[]) => buildNativeLeagueNavigation(tabs, false).find((g) => g.id === 'league')!.items

describe('Pirate Deck in the league navigation', () => {
  it('leads "This league" as its own tab, with the anchor icon', () => {
    const items = thisLeague([...BASE.slice(0, 2), { id: 'pirate', label: 'Pirate Deck' }, ...BASE.slice(2)])
    expect(items[0]).toMatchObject({ id: 'pirate', label: 'Pirate Deck', icon: 'pirate' })
  })

  it('is no longer a League sub-tab after Legacy', () => {
    const items = thisLeague([{ id: 'pirate', label: 'Pirate Deck' }, ...BASE])
    expect(items.find((i) => i.label === 'League')!.children.map((c) => c.id)).not.toContain('pirate')
  })

  it('appears only in pirate leagues', () => {
    expect(thisLeague(BASE).some((i) => i.id === 'pirate')).toBe(false)
  })
})
