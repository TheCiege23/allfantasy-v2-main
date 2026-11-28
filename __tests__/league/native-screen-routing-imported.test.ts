/**
 * Which native screen a tab opens (lib/league/native/lineupScreenRouting.ts `nativeScreenFor`). Since 2026-11-22 an
 * imported league shown in the workspace gets the native Matchup, Team, Trades and Standings, so every league looks the
 * same. A league hosted here is unchanged, and an import embedded in the dashboard iframe keeps every classic screen.
 */
import { describe, expect, it } from 'vitest'
import { nativeScreenFor } from '@/lib/league/native/lineupScreenRouting'

const base = { leagueVariant: null, idp: false, bestBall: false, collegeRoster: false }
const hosted = { ...base, hosted: true, inWorkspace: true }
const imported = { ...base, hosted: false, inWorkspace: true }
const embeddedImport = { ...base, hosted: false, inWorkspace: false }

const TABS = ['matchups', 'matchup', 'roster', 'team', 'squad', 'waivers', 'trades', 'standings', 'decide', 'native_home']
const map = (league: Parameters<typeof nativeScreenFor>[1]) => Object.fromEntries(TABS.map((tab) => [tab, nativeScreenFor(tab, league)]))

describe('nativeScreenFor', () => {
  it('a league hosted here gets all five native screens, as before', () => {
    expect(map(hosted)).toEqual({
      matchups: 'matchup', matchup: 'matchup', roster: 'lineup', team: 'lineup', squad: 'lineup',
      waivers: 'waivers', trades: 'trades', standings: 'standings', decide: null, native_home: null,
    })
  })

  it('an imported league in the workspace gets all five native screens, Waivers included', () => {
    expect(map(imported)).toEqual({
      matchups: 'matchup', matchup: 'matchup', roster: 'lineup', team: 'lineup', squad: 'lineup',
      waivers: 'waivers', trades: 'trades', standings: 'standings', decide: null, native_home: null,
    })
  })

  it('an imported league embedded in the dashboard iframe keeps every classic screen', () => {
    expect(Object.values(map(embeddedImport)).every((screen) => screen === null)).toBe(true)
  })

  it('an imported college/pro league (C2C or devy by type) keeps its two-lineup Team tab', () => {
    expect(nativeScreenFor('roster', { ...imported, collegeRoster: true })).toBeNull()
    expect(nativeScreenFor('matchups', { ...imported, collegeRoster: true })).toBe('matchup')
    // A hosted league is decided by its variant alone, exactly as before.
    expect(nativeScreenFor('roster', { ...hosted, collegeRoster: true })).toBe('lineup')
  })

  it('IDP, best ball and college variants keep the classic Team tab everywhere; Big Brother keeps its standings', () => {
    for (const league of [hosted, imported]) {
      expect(nativeScreenFor('roster', { ...league, idp: true })).toBeNull()
      expect(nativeScreenFor('roster', { ...league, bestBall: true })).toBeNull()
      expect(nativeScreenFor('roster', { ...league, leagueVariant: 'devy' })).toBeNull()
      expect(nativeScreenFor('standings', { ...league, leagueVariant: 'big_brother' })).toBeNull()
    }
  })
})

describe("Soccer's tab names open the same new screens (2026-11-28)", () => {
  it.each([
    ['fixtures', 'matchup'],
    ['transfers', 'trades'],
    ['table', 'standings'],
  ] as const)('%s opens the %s screen, hosted or imported in the workspace', (tab, screen) => {
    expect(nativeScreenFor(tab, hosted)).toBe(screen)
    expect(nativeScreenFor(tab, imported)).toBe(screen)
  })

  it('[control] an import embedded in the dashboard keeps the classic Soccer tabs, and Big Brother keeps its table', () => {
    for (const tab of ['fixtures', 'transfers', 'table']) expect(nativeScreenFor(tab, embeddedImport)).toBeNull()
    expect(nativeScreenFor('table', { ...hosted, leagueVariant: 'big_brother' })).toBeNull()
  })
})
