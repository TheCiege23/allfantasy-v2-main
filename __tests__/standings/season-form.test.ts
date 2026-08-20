import { describe, it, expect } from 'vitest'
import {
  computeAllPlay,
  computeStreaks,
  formatAllPlay,
  formatStreak,
  normalizeOutcome,
  type WeekResultInput,
} from '@/lib/standings/seasonForm'

/** Three rosters, three weeks. Scores chosen so all-play is checkable by hand. */
function fixture(): WeekResultInput[] {
  return [
    { week: 1, rosterId: 'a', totalPoints: 120, winLoss: 'W' },
    { week: 1, rosterId: 'b', totalPoints: 110, winLoss: 'L' },
    { week: 1, rosterId: 'c', totalPoints: 100, winLoss: 'L' },
    { week: 2, rosterId: 'a', totalPoints: 90, winLoss: 'L' },
    { week: 2, rosterId: 'b', totalPoints: 130, winLoss: 'W' },
    { week: 2, rosterId: 'c', totalPoints: 95, winLoss: 'W' },
    { week: 3, rosterId: 'a', totalPoints: 105, winLoss: 'L' },
    { week: 3, rosterId: 'b', totalPoints: 140, winLoss: 'W' },
    { week: 3, rosterId: 'c', totalPoints: 105, winLoss: 'T' },
  ]
}

describe('standings 9a — season form derived from real weekly results', () => {
  describe('normalizeOutcome', () => {
    it('accepts the short and long forms in any casing', () => {
      expect(normalizeOutcome('W')).toBe('W')
      expect(normalizeOutcome('win')).toBe('W')
      expect(normalizeOutcome('LOSS')).toBe('L')
      expect(normalizeOutcome('tie')).toBe('T')
      expect(normalizeOutcome('draw')).toBe('T')
    })

    it('returns null for unplayed / unrecognised values rather than guessing', () => {
      expect(normalizeOutcome(null)).toBeNull()
      expect(normalizeOutcome(undefined)).toBeNull()
      expect(normalizeOutcome('')).toBeNull()
      expect(normalizeOutcome('   ')).toBeNull()
      expect(normalizeOutcome('pending')).toBeNull()
    })
  })

  describe('computeStreaks', () => {
    it('measures the trailing run from the latest played week', () => {
      const s = computeStreaks(fixture())
      expect(s.get('a')).toEqual({ outcome: 'L', length: 2 }) // W, L, L
      expect(s.get('b')).toEqual({ outcome: 'W', length: 2 }) // L, W, W
      expect(s.get('c')).toEqual({ outcome: 'T', length: 1 }) // L, W, T
    })

    it('orders by week rather than trusting input order', () => {
      const shuffled = [...fixture()].reverse()
      expect(computeStreaks(shuffled).get('b')).toEqual({ outcome: 'W', length: 2 })
    })

    it('omits a roster with no played weeks instead of reporting W0', () => {
      const s = computeStreaks([{ week: 1, rosterId: 'z', totalPoints: 0, winLoss: null }])
      expect(s.get('z')).toBeUndefined()
      expect(formatStreak(s.get('z'))).toBe('—')
    })

    it('an unplayed trailing week does not reset the streak', () => {
      const s = computeStreaks([
        { week: 1, rosterId: 'a', totalPoints: 100, winLoss: 'W' },
        { week: 2, rosterId: 'a', totalPoints: 100, winLoss: 'W' },
        { week: 3, rosterId: 'a', totalPoints: 0, winLoss: null }, // not yet played
      ])
      expect(s.get('a')).toEqual({ outcome: 'W', length: 2 })
    })
  })

  describe('computeAllPlay', () => {
    it('compares every team against every other team, each week', () => {
      const ap = computeAllPlay(fixture())
      // a: wk1 beats b,c (2-0) · wk2 loses to BOTH — 90 is under c's 95 (0-2) · wk3 loses to b, ties c (0-1-1)
      expect(ap.get('a')).toEqual({ wins: 2, losses: 3, ties: 1 })
      // b: wk1 loses to a, beats c (1-1) · wk2 beats both (2-0) · wk3 beats both (2-0)
      expect(ap.get('b')).toEqual({ wins: 5, losses: 1, ties: 0 })
      // c: wk1 loses both (0-2) · wk2 loses to b, beats a (1-1) · wk3 loses to b, ties a (0-1-1)
      expect(ap.get('c')).toEqual({ wins: 1, losses: 4, ties: 1 })
    })

    it('every comparison is counted exactly once for each side', () => {
      const ap = computeAllPlay(fixture())
      const total = [...ap.values()].reduce((n, r) => n + r.wins + r.losses + r.ties, 0)
      // 3 weeks x 3 pairings x 2 sides
      expect(total).toBe(18)
      const wins = [...ap.values()].reduce((n, r) => n + r.wins, 0)
      const losses = [...ap.values()].reduce((n, r) => n + r.losses, 0)
      expect(wins).toBe(losses)
    })

    it('excludes unplayed rosters rather than counting them as losses for everyone else', () => {
      const ap = computeAllPlay([
        { week: 1, rosterId: 'a', totalPoints: 120, winLoss: 'W' },
        { week: 1, rosterId: 'b', totalPoints: 110, winLoss: 'L' },
        { week: 1, rosterId: 'ghost', totalPoints: 0, winLoss: null },
      ])
      expect(ap.get('a')).toEqual({ wins: 1, losses: 0, ties: 0 })
      expect(ap.get('ghost')).toBeUndefined()
    })

    it('contributes nothing for a week with fewer than two played rosters', () => {
      const ap = computeAllPlay([{ week: 1, rosterId: 'a', totalPoints: 120, winLoss: 'W' }])
      expect(ap.size).toBe(0)
    })

    it('equal scores tie both sides', () => {
      const ap = computeAllPlay([
        { week: 1, rosterId: 'a', totalPoints: 100, winLoss: 'T' },
        { week: 1, rosterId: 'b', totalPoints: 100, winLoss: 'T' },
      ])
      expect(ap.get('a')).toEqual({ wins: 0, losses: 0, ties: 1 })
      expect(ap.get('b')).toEqual({ wins: 0, losses: 0, ties: 1 })
    })
  })

  describe('display formatting', () => {
    it('formats streak and all-play the way the handoff shows them', () => {
      expect(formatStreak({ outcome: 'W', length: 4 })).toBe('W4')
      expect(formatAllPlay({ wins: 92, losses: 29, ties: 0 })).toBe('92-29')
    })

    it('appends ties only when there are any, and degrades to a dash on no data', () => {
      expect(formatAllPlay({ wins: 5, losses: 1, ties: 2 })).toBe('5-1-2')
      expect(formatAllPlay(undefined)).toBe('—')
      expect(formatStreak(null)).toBe('—')
      expect(formatStreak({ outcome: 'W', length: 0 })).toBe('—')
    })
  })
})
