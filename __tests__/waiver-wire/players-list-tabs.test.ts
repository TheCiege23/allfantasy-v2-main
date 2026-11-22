/**
 * The Players screen's tabs follow Sleeper's (owner ask, 2026-11-22), and the list carries last
 * week's points under the league's own scoring.
 */
import { describe, expect, it } from 'vitest'
import { PLAYERS_TABS, leagueScopeRows, rosteredByLabel, tabUsesLeagueScope } from '@/lib/waiver-wire/playersListTabs'
import { lastCompletedWeek, rosterOwnership } from '@/lib/waiver-wire/lastWeekPoints'

const rows = [
  { id: 'a', name: 'Free Agent', team: 'DAL', projectedPoints: 9, lastWeekPoints: 4, rosteredBy: null },
  { id: 'b', name: 'Mine Guy', team: 'PHI', projectedPoints: 20, lastWeekPoints: 31, rosteredBy: { mine: true, team: 'My Team' } },
  { id: 'c', name: 'Their Star', team: 'KC', projectedPoints: 18, lastWeekPoints: 12, rosteredBy: { mine: false, team: 'Rivals' } },
  { id: 'd', name: 'Their Bench', team: 'KC', projectedPoints: 3, lastWeekPoints: null, rosteredBy: { mine: false, team: null } },
]

describe('PLAYERS_TABS', () => {
  it("leads with Sleeper's five, in Sleeper's order, and keeps ours", () => {
    expect(PLAYERS_TABS.map((t) => t.label)).toEqual(['Search', 'Trend', 'Available', 'Leaders', 'Trade', 'Watchlist', 'My claims'])
  })

  it('reads the league-wide list for Search, Leaders and Trade only', () => {
    expect(PLAYERS_TABS.filter((t) => tabUsesLeagueScope(t.id)).map((t) => t.id)).toEqual(['search', 'leaders', 'trade'])
  })
})

describe('leagueScopeRows', () => {
  it('Search shows nobody until a name is typed, then rostered players too', () => {
    expect(leagueScopeRows('search', rows, '  ', true)).toEqual([])
    expect(leagueScopeRows('search', rows, 'their', true).map((p) => p.id)).toEqual(['c', 'd'])
  })

  it("Leaders ranks everyone by last week's points, a player with no game last", () => {
    expect(leagueScopeRows('leaders', rows, '', true).map((p) => p.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('Leaders falls back to the projection where the league has no weekly figure', () => {
    expect(leagueScopeRows('leaders', rows, '', false).map((p) => p.id)).toEqual(['b', 'c', 'a', 'd'].sort((x, y) =>
      (rows.find((r) => r.id === y)!.projectedPoints ?? 0) - (rows.find((r) => r.id === x)!.projectedPoints ?? 0)))
  })

  it("Trade lists other teams' players only, best projection first", () => {
    expect(leagueScopeRows('trade', rows, '', true).map((p) => p.id)).toEqual(['c', 'd'])
  })
})

describe('rosteredByLabel', () => {
  it('names the team, the viewer, or nobody', () => {
    expect(rosteredByLabel(null)).toBeNull()
    expect(rosteredByLabel({ mine: true, team: 'My Team' })).toBe('On your team')
    expect(rosteredByLabel({ mine: false, team: 'Rivals' })).toBe('On Rivals')
    expect(rosteredByLabel({ mine: false, team: null })).toBe('Rostered')
  })
})

describe('lastCompletedWeek', () => {
  it('is the week before the one being projected', () => {
    expect(lastCompletedWeek(12)).toBe(11)
  })

  it('is nothing in week 1 or when the week is unknown', () => {
    for (const v of [1, 0, null, undefined, 2.5]) expect(lastCompletedWeek(v as never)).toBeNull()
  })
})

describe('rosterOwnership', () => {
  it('maps each rostered id to its team, and marks the viewer', () => {
    const map = rosterOwnership(
      [
        { id: 'r1', platformUserId: 'u1', playerIds: ['96', 'PHI'] },
        { id: 'r2', platformUserId: 'u2', playerIds: ['4034'] },
        { id: 'r3', platformUserId: 'u3', playerIds: ['77'] },
      ],
      [{ externalId: 'u1', teamName: 'Mine' }, { externalId: 'u2', teamName: ' ', ownerName: 'Sam' }],
      'r1',
    )
    expect(map.get('96')).toEqual({ mine: true, team: 'Mine' })
    expect(map.get('4034')).toEqual({ mine: false, team: 'Sam' })
    expect(map.get('77')).toEqual({ mine: false, team: null })
    expect(map.get('nobody')).toBeUndefined()
  })
})
