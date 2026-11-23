/**
 * Keeper window: Keepers is its own top tab (2026-11-22, keeper audit item 5).
 *
 * LeagueShell adds a `keeper` tab only while a keeper league's keeper window is open — the one thing every manager
 * has to do then. The navigation had no place for it, so it fell to the END of League's sub-tabs, after Legacy:
 * clipped off the sub-tab row at 820 and 390, and absent from the sidebar. It now leads "This league", the way Draft
 * gets its own top tab before the draft, and disappears with the window.
 */
import { describe, expect, it } from 'vitest'
import { buildNativeLeagueNavigation } from '@/lib/league/nativeLeagueNavigation'

const BASE = [
  { id: 'native_home', label: 'League home' }, { id: 'matchups', label: 'Matchup' }, { id: 'war_room', label: 'War Room' },
  { id: 'roster', label: 'My team' }, { id: 'waivers', label: 'Players & waivers' }, { id: 'standings', label: 'Standings' },
  { id: 'league_chat', label: 'League chat' }, { id: 'legacy', label: 'Legacy' }, { id: 'trades', label: 'Trades' },
  { id: 'draft', label: 'Draft' }, { id: 'settings', label: 'Settings' }, { id: 'commissioner', label: 'Commissioner tools' },
]

const thisLeague = (tabs: { id: string; label: string }[]) => buildNativeLeagueNavigation(tabs, true).find((g) => g.id === 'league')!.items

describe('Keepers in the league navigation', () => {
  it('leads "This league" as its own tab while the keeper window is open', () => {
    const items = thisLeague([{ id: 'keeper', label: 'Keepers' }, ...BASE])
    expect(items[0]).toMatchObject({ id: 'keeper', label: 'Keepers' })
    expect(items[0].children.map((c) => c.id)).toEqual(['keeper'])
  })

  it('is no longer a League sub-tab after Legacy', () => {
    const items = thisLeague([{ id: 'keeper', label: 'Keepers' }, ...BASE])
    const league = items.find((i) => i.label === 'League')!
    expect(league.children.map((c) => c.id)).not.toContain('keeper')
  })

  it('appears only when the keeper tab exists', () => {
    expect(thisLeague(BASE).some((i) => i.id === 'keeper')).toBe(false)
  })
})
