import { describe, expect, it } from 'vitest'
import {
  FAVORITES_SECTION,
  moveInOrder,
  passesRailFilter,
  railFilterCounts,
  railSections,
  reorderWithinSection,
  toggleFavorite,
} from '@/lib/core-app/railArrange'
import { railRecordsFrom, type RailRecordTeam } from '@/lib/core-app/railRecordRank'

const rows = [
  { id: 'a', sport: 'NFL' },
  { id: 'b', sport: 'NBA' },
  { id: 'c', sport: 'NFL' },
  { id: 'd', sport: 'NBA' },
  { id: 'h', sport: 'NFL', hub: { id: 'hub1' } },
]

describe('railSections — favorites on top, then by sport', () => {
  it('pins favorites in the account order and leaves the rest by sport', () => {
    const out = railSections(rows, new Set(['d', 'a']))
    expect(out.map((s) => [s.key, s.rows.map((r) => r.id)])).toEqual([
      [FAVORITES_SECTION, ['a', 'd']],
      ['NFL', ['c', 'h']],
      ['NBA', ['b']],
    ])
  })

  it('no favorites, no favorites section; a hub is never pinned on its own', () => {
    expect(railSections(rows, new Set()).map((s) => s.key)).toEqual(['NFL', 'NBA'])
    expect(railSections(rows, new Set(['h'])).map((s) => s.key)).toEqual(['NFL', 'NBA'])
  })
})

describe('filters', () => {
  const facts = [
    { live: true, commissioner: false, needs: true },
    { live: false, commissioner: true, needs: false },
    { live: false, commissioner: false, needs: false },
  ]
  it('counts each chip', () => {
    expect(railFilterCounts(facts)).toEqual({ all: 3, live: 1, commissioner: 1, needs: 1 })
  })
  it('passes the rows each filter names; a hub card (no facts) only under All', () => {
    expect(facts.map((f) => passesRailFilter('live', f))).toEqual([true, false, false])
    expect(facts.map((f) => passesRailFilter('commissioner', f))).toEqual([false, true, false])
    expect(facts.map((f) => passesRailFilter('needs', f))).toEqual([true, false, false])
    expect(passesRailFilter('all', null)).toBe(true)
    expect(passesRailFilter('live', null)).toBe(false)
  })
})

describe('moveInOrder — one place within the section the reader sees', () => {
  const full = ['a', 'x', 'b', 'c', 'hidden', 'd']
  it('trades places with the visible neighbour, even across leagues of another sport or hidden ones', () => {
    expect(moveInOrder(full, ['a', 'c'], 'c', -1)).toEqual(['c', 'x', 'b', 'a', 'hidden', 'd'])
    expect(moveInOrder(full, ['b', 'd'], 'b', 1)).toEqual(['a', 'x', 'd', 'c', 'hidden', 'b'])
  })
  it('is null at either end, or for a league not in the section', () => {
    expect(moveInOrder(full, ['a', 'c'], 'a', -1)).toBeNull()
    expect(moveInOrder(full, ['a', 'c'], 'c', 1)).toBeNull()
    expect(moveInOrder(full, ['a', 'c'], 'b', 1)).toBeNull()
  })
})

describe('toggleFavorite', () => {
  it('adds to the end and removes in place', () => {
    expect(toggleFavorite(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(toggleFavorite(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })
})

describe('railRecordsFrom — your record and place', () => {
  const team = (leagueId: string, externalId: string, wins: number, losses: number, over: Partial<RailRecordTeam> = {}): RailRecordTeam => ({
    leagueId, externalId, wins, losses, ties: 0, pointsFor: 0, currentRank: null, ...over,
  })

  it("uses the platform's own rank when it published one — its tiebreakers, not ours", () => {
    const out = railRecordsFrom([{ leagueId: 'L', externalId: 'me' }], [
      team('L', 'me', 6, 3, { currentRank: 3, pointsFor: 900 }),
      team('L', 'x', 6, 3, { currentRank: 2, pointsFor: 800 }),
      team('L', 'y', 7, 2, { currentRank: 1 }),
    ])
    expect(out.L).toEqual({ wins: 6, losses: 3, ties: 0, rank: 3, teams: 3 })
  })

  it('otherwise places by winning percentage, then points for; a tie on both shares the place', () => {
    const out = railRecordsFrom([{ leagueId: 'L', externalId: 'me' }], [
      team('L', 'me', 6, 3, { pointsFor: 900 }),
      team('L', 'x', 6, 3, { pointsFor: 800 }),
      team('L', 'y', 7, 2, { pointsFor: 700 }),
      team('L', 'z', 6, 3, { pointsFor: 900 }),
    ])
    expect(out.L?.rank).toBe(2)
  })

  it('counts a tie as half a win, and shows ties in the record', () => {
    const out = railRecordsFrom([{ leagueId: 'L', externalId: 'me' }], [
      team('L', 'me', 5, 3, { ties: 1 }),
      team('L', 'x', 5, 4),
    ])
    expect(out.L).toMatchObject({ wins: 5, losses: 3, ties: 1, rank: 1 })
  })

  it('no games played, no line — and a league you have no team in is absent', () => {
    const out = railRecordsFrom([{ leagueId: 'L', externalId: 'me' }, { leagueId: 'M', externalId: 'ghost' }], [
      team('L', 'me', 0, 0, { currentRank: 1 }),
      team('M', 'other', 3, 1),
    ])
    expect(out).toEqual({})
  })
})

describe('reorderWithinSection — drag a league anywhere in the section the reader sees', () => {
  // NFL a, c, e among NBA x, y and a hidden league; the NFL leagues hold slots 0, 2 and 5.
  const full = ['a', 'x', 'c', 'y', 'hidden', 'e']
  const nfl = ['a', 'c', 'e']

  it('moves it to the new index and leaves every other league in its place', () => {
    expect(reorderWithinSection(full, nfl, 'e', 0)).toEqual(['e', 'x', 'a', 'y', 'hidden', 'c'])
    expect(reorderWithinSection(full, nfl, 'a', 2)).toEqual(['c', 'x', 'e', 'y', 'hidden', 'a'])
    expect(reorderWithinSection(full, nfl, 'a', 1)).toEqual(['c', 'x', 'a', 'y', 'hidden', 'e'])
  })

  it('one place is the same as Move', () => {
    expect(reorderWithinSection(full, nfl, 'c', 0)).toEqual(moveInOrder(full, nfl, 'c', -1))
    expect(reorderWithinSection(full, nfl, 'c', 2)).toEqual(moveInOrder(full, nfl, 'c', 1))
  })

  it('fills the section slots top to bottom even when the visible order disagrees with the saved one', () => {
    // On screen: e, a, c (say, a stale saved order). Drag c to the top: the reader's order wins.
    expect(reorderWithinSection(full, ['e', 'a', 'c'], 'c', 0)).toEqual(['c', 'x', 'e', 'y', 'hidden', 'a'])
  })

  it('null when nothing changes or the league is not in the section; out-of-range indexes clamp', () => {
    expect(reorderWithinSection(full, nfl, 'c', 1)).toBeNull()
    expect(reorderWithinSection(full, nfl, 'x', 0)).toBeNull()
    expect(reorderWithinSection(full, nfl, 'a', 99)).toEqual(reorderWithinSection(full, nfl, 'a', 2))
    expect(reorderWithinSection(full, nfl, 'e', -5)).toEqual(reorderWithinSection(full, nfl, 'e', 0))
  })
})
