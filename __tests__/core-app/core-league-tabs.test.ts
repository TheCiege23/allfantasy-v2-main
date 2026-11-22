/**
 * Inside a league, the /core rail is Sleeper's tabs (owner, 2026-11-19): the league's screens fold into Matchup, Team,
 * League, Trade and Settings (lib/core-app/leagueDestinations.ts LEAGUE_TABS). Nothing the rail used to list may become
 * unreachable.
 */
import { describe, expect, it } from 'vitest'
import { LEAGUE_SCOPED_SECTIONS, LEAGUE_TABS, NAV_SECTION_ORDER, groupLeagueTabs } from '@/lib/core-app/leagueDestinations'

const item = (key: string) => ({ key, href: `/core/${key}` })
const railWith = (keys?: Set<string>) =>
  NAV_SECTION_ORDER.map((s) => ({ id: s.id, items: s.keys.filter((k) => !keys || keys.has(k)).map(item) }))

describe('the /core league tabs', () => {
  it('are the Sleeper tabs, with each league screen under exactly one', () => {
    const tabs = groupLeagueTabs(railWith())
    expect(tabs.map((t) => t.label)).toEqual(['Matchup', 'Team', 'League', 'Trade', 'League settings'])
    expect(Object.fromEntries(tabs.map((t) => [t.id, t.children.map((c) => c.key)]))).toEqual({
      matchup: ['matchup', 'live', 'schedule', 'war-room'],
      team: ['my-team', 'waivers', 'players', 'defense-hub', 'devy-league'],
      league: ['home', 'standings', 'draft-hq'],
      trade: ['trades', 'season-outlook'],
      settings: ['league-settings', 'commissioner'],
    })
  })

  it('every screen the league-scoped rail sections listed is under a tab, and only those', () => {
    const scoped = NAV_SECTION_ORDER.filter((s) => LEAGUE_SCOPED_SECTIONS.has(s.id)).flatMap((s) => s.keys)
    const placed = groupLeagueTabs(railWith()).flatMap((t) => t.children.map((c) => c.key))
    expect([...placed].sort()).toEqual([...scoped].sort())
    expect(new Set(placed).size).toBe(placed.length)
  })

  it('a screen the league cannot show drops out, and a tab with none left is not drawn', () => {
    // A league with no trades and no commissioner role: Trade keeps Season Outlook; Settings keeps League settings.
    const keys = new Set(NAV_SECTION_ORDER.flatMap((s) => s.keys).filter((k) => k !== 'trades' && k !== 'commissioner'))
    const tabs = groupLeagueTabs(railWith(keys))
    expect(tabs.find((t) => t.id === 'trade')?.children.map((c) => c.key)).toEqual(['season-outlook'])
    const none = groupLeagueTabs(railWith(new Set(['home', 'my-team'])))
    expect(none.map((t) => t.id)).toEqual(['team', 'league'])
  })

  it('a league-scoped screen no tab names still lands under League', () => {
    const tabs = groupLeagueTabs([{ id: 'plan', items: [item('home'), item('brand-new-screen')] }])
    expect(tabs.find((t) => t.id === 'league')?.children.map((c) => c.key)).toEqual(['home', 'brand-new-screen'])
  })

  it('account-wide sections are not folded in', () => {
    const tabs = groupLeagueTabs([{ id: 'all', items: [item('rankings')] }, { id: 'manage', items: [item('settings')] }, { id: 'now', items: [item('matchup')] }])
    expect(tabs.flatMap((t) => t.children.map((c) => c.key))).toEqual(['matchup'])
  })

  it('every key a tab names is a real rail destination', () => {
    const all = new Set(NAV_SECTION_ORDER.flatMap((s) => s.keys))
    for (const tab of LEAGUE_TABS) for (const key of tab.keys) expect(all.has(key), key).toBe(true)
  })
})
