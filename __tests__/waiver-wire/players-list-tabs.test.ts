/**
 * The Players screen's tabs follow Sleeper's (owner ask, 2026-11-22), and the list carries last
 * week's points under the league's own scoring.
 */
import { describe, expect, it } from 'vitest'
import { PLAYERS_TABS, leagueScopeRows, rosteredByLabel, tabUsesLeagueScope } from '@/lib/waiver-wire/playersListTabs'
import { lastCompletedWeek, lastEndedWeek, rosterOwnership, scoreWeekLines } from '@/lib/waiver-wire/lastWeekPoints'

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
    expect(map.get('96')).toEqual({ mine: true, team: 'Mine', rosterId: 'r1' })
    expect(map.get('4034')).toEqual({ mine: false, team: 'Sam', rosterId: 'r2' })
    expect(map.get('77')).toEqual({ mine: false, team: null, rosterId: 'r3' })
    expect(map.get('nobody')).toBeUndefined()
  })
})

describe('scoreWeekLines', () => {
  it("prices each player's week with the league's scorer, by his position", () => {
    const scorer = (line: Record<string, number>, position?: string | null) => (line.points ?? 0) + (position === 'C' ? (line.rebounds ?? 0) * 1.2 : 0)
    const out = scoreWeekLines(
      new Map([['201939', { points: 81, rebounds: 10 }], ['203999', { points: 60, rebounds: 30 }]]),
      new Map([['201939', 'PG'], ['203999', 'C']]),
      scorer,
    )
    expect(out.get('201939')).toBe(81)
    expect(out.get('203999')).toBe(96)
  })

  it('leaves out a player with no line, and a line the scorer cannot price', () => {
    const out = scoreWeekLines(new Map([['a', { points: 1 }]]), new Map(), () => Number.NaN)
    expect(out.size).toBe(0)
  })
})

describe('lastEndedWeek', () => {
  const day = (d: string) => new Date(`${d}T00:00:00.000Z`)
  // Three gameweeks with a two-week break after the second, the shape of a soccer calendar.
  const starts = ['2026-08-21', '2026-08-28', '2026-09-18']
  const windowFor = (week: number) => {
    const start = starts[week - 1]
    return start ? { start: day(start), end: new Date(day(start).getTime() + 7 * 86_400_000) } : null
  }

  it('is the latest gameweek that has ended, during a break between gameweeks', () => {
    expect(lastEndedWeek(windowFor, day('2026-09-10'))).toBe(2)
  })

  it('does not count the gameweek in progress', () => {
    expect(lastEndedWeek(windowFor, day('2026-08-30'))).toBe(1)
  })

  it('is nothing before the first gameweek has ended', () => {
    expect(lastEndedWeek(windowFor, day('2026-08-22'))).toBeNull()
    expect(lastEndedWeek(windowFor, day('2026-08-01'))).toBeNull()
  })

  it('is the final gameweek once the calendar has run out', () => {
    expect(lastEndedWeek(windowFor, day('2027-01-01'))).toBe(3)
  })
})
