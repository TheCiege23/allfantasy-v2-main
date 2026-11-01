import { describe, expect, it } from 'vitest'
import { reviewStatCorrections, type StarterStatLine } from '@/lib/stat-corrections/statCorrectionReview'

// One point per yard over ten, so the arithmetic in each case is readable.
const score = (s: Record<string, number>) => (s.yds ?? 0) / 10

const line = (over: Partial<StarterStatLine>): StarterStatLine => ({
  rosterId: 'A',
  playerId: 'p1',
  playerName: 'Player One',
  position: 'RB',
  storedStats: { yds: 100 },
  freshStats: { yds: 100 },
  ...over,
})

const matchup = { matchupId: 'm1', homeRosterId: 'A', awayRosterId: 'B', homeScore: 100, awayScore: 99 }

describe('reviewStatCorrections', () => {
  it('reports nothing, and no fingerprint, when the fresh stats score the same', () => {
    const r = reviewStatCorrections({ starters: [line({}), line({ playerId: 'p2', freshStats: { yds: 100.04 } })], matchups: [matchup], score })
    expect(r).toEqual({ changes: [], matchups: [], unchecked: 0, fingerprint: '' })
  })

  it('lists a changed starter and carries the change onto the stored matchup score', () => {
    const r = reviewStatCorrections({ starters: [line({ freshStats: { yds: 85 } })], matchups: [matchup], score })
    expect(r.changes).toEqual([{ rosterId: 'A', playerId: 'p1', playerName: 'Player One', position: 'RB', before: 10, after: 8.5, delta: -1.5 }])
    expect(r.matchups).toEqual([
      { matchupId: 'm1', home: { rosterId: 'A', before: 100, after: 98.5 }, away: { rosterId: 'B', before: 99, after: 99 }, resultFlipped: true },
    ])
    expect(r.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })

  it('does not flag a flip when the winner holds, and does flag a win turning into a tie', () => {
    const holds = reviewStatCorrections({ starters: [line({ freshStats: { yds: 95 } })], matchups: [matchup], score })
    expect(holds.matchups[0].resultFlipped).toBe(false)
    const tie = reviewStatCorrections({ starters: [line({ freshStats: { yds: 90 } })], matchups: [matchup], score })
    expect(tie.matchups[0].home.after).toBe(99)
    expect(tie.matchups[0].resultFlipped).toBe(true)
  })

  it('counts a starter with no stored row or no fresh line as unchecked, never as a correction to zero', () => {
    const r = reviewStatCorrections({
      starters: [line({ storedStats: null }), line({ playerId: 'p2', freshStats: null })],
      matchups: [matchup],
      score,
    })
    expect(r.changes).toEqual([])
    expect(r.unchecked).toBe(2)
  })

  it('leaves untouched matchups out and nets several changes on one roster', () => {
    const other = { matchupId: 'm2', homeRosterId: 'C', awayRosterId: 'D', homeScore: 80, awayScore: 70 }
    const r = reviewStatCorrections({
      starters: [line({ freshStats: { yds: 120 } }), line({ playerId: 'p2', freshStats: { yds: 90 } })],
      matchups: [matchup, other],
      score,
    })
    expect(r.matchups.map((m) => m.matchupId)).toEqual(['m1'])
    expect(r.matchups[0].home.after).toBe(101)
  })

  it('gives the same fingerprint for the same corrections in any order, and a new one when a value moves', () => {
    const a = line({ freshStats: { yds: 120 } })
    const b = line({ playerId: 'p2', rosterId: 'B', freshStats: { yds: 90 } })
    const one = reviewStatCorrections({ starters: [a, b], matchups: [matchup], score }).fingerprint
    const two = reviewStatCorrections({ starters: [b, a], matchups: [matchup], score }).fingerprint
    const moved = reviewStatCorrections({ starters: [a, { ...b, freshStats: { yds: 80 } }], matchups: [matchup], score }).fingerprint
    expect(one).toBe(two)
    expect(moved).not.toBe(one)
  })

  describe('daily-lineup starters (one line per day started)', () => {
    const days = (d: StarterStatLine['days']) => line({ storedStats: null, freshStats: null, days: d })

    it('sums the started days on each side and reports the difference', () => {
      const r = reviewStatCorrections({
        starters: [days([
          { storedStats: { yds: 100 }, freshStats: { yds: 100 } },
          { storedStats: { yds: 50 }, freshStats: { yds: 30 } },
        ])],
        matchups: [matchup],
        score,
      })
      expect(r.changes).toEqual([{ rosterId: 'A', playerId: 'p1', playerName: 'Player One', position: 'RB', before: 15, after: 13, delta: -2 }])
      expect(r.matchups[0].home.after).toBe(98)
    })

    it('a day that had no line and now has one adds its points; one struck off removes them', () => {
      const added = reviewStatCorrections({
        starters: [days([{ storedStats: { yds: 100 }, freshStats: { yds: 100 } }, { storedStats: null, freshStats: { yds: 20 } }])],
        matchups: [matchup],
        score,
      })
      expect(added.changes[0]).toMatchObject({ before: 10, after: 12, delta: 2 })
      const removed = reviewStatCorrections({
        starters: [days([{ storedStats: { yds: 100 }, freshStats: { yds: 100 } }, { storedStats: { yds: 20 }, freshStats: null }])],
        matchups: [matchup],
        score,
      })
      expect(removed.changes[0]).toMatchObject({ before: 12, after: 10, delta: -2 })
    })

    it('no game on any started day is nothing to check; a whole side missing is unchecked', () => {
      const idle = reviewStatCorrections({ starters: [days([{ storedStats: null, freshStats: null }])], matchups: [matchup], score })
      expect(idle).toEqual({ changes: [], matchups: [], unchecked: 0, fingerprint: '' })
      const gap = reviewStatCorrections({ starters: [days([{ storedStats: { yds: 100 }, freshStats: null }])], matchups: [matchup], score })
      expect(gap.unchecked).toBe(1)
      expect(gap.changes).toEqual([])
    })
  })
})
