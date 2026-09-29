import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ buildRosterIdResolver: () => () => null }))

import { buildEligibleTeamsWithOdds, computeWeight, type StandingsRow } from '@/lib/draft-lottery/standingsForLottery'

/*
 * 🛑 THE WEIGHTED LOTTERY GAVE EVERY TEAM THE SAME ODDS (fixed 2026-09-29). `inverse_standings`
 * floored every weight to 1 (rank 1 = best, and it computed bestRank - rank + 1), and the PF modes
 * computed 1000 - PF, which a real season's points-for (well over 1,000) floors to 0.1 for everyone.
 * The settings screen promises "Worse teams get better odds at top picks".
 */

const row = (rosterId: string, rank: number, pointsFor: number, maxPf = pointsFor): StandingsRow => ({
  rosterId, displayName: rosterId, teamIndex: rank, rank, wins: 0, losses: 0, ties: 0, pointsFor, maxPf,
})

// The non-playoff pool of a 12-team league: ranks 7..12, realistic season scoring.
const POOL = [row('r7', 7, 1450, 1700), row('r8', 8, 1400, 1650), row('r9', 9, 1390, 1690), row('r10', 10, 1300, 1500), row('r11', 11, 1250, 1480), row('r12', 12, 1180, 1400)]
const odds = (mode: Parameters<typeof buildEligibleTeamsWithOdds>[1]) =>
  Object.fromEntries(buildEligibleTeamsWithOdds(POOL, mode).map((t) => [t.rosterId, t.weight]))

describe('weighted lottery weights', () => {
  it('inverse_standings: the worst record gets the most weight, the best in the pool gets 1', () => {
    expect(odds('inverse_standings')).toEqual({ r7: 1, r8: 2, r9: 3, r10: 4, r11: 5, r12: 6 })
  })

  it('inverse_points_for: the lowest scorer gets the most weight, on real season totals', () => {
    expect(odds('inverse_points_for')).toEqual({ r7: 1, r8: 2, r9: 3, r10: 4, r11: 5, r12: 6 })
  })

  it('inverse_max_pf ranks on max PF, not PF', () => {
    // max PF order (high→low): r7 1700, r9 1690, r8 1650, r10 1500, r11 1480, r12 1400.
    expect(odds('inverse_max_pf')).toEqual({ r7: 1, r9: 2, r8: 3, r10: 4, r11: 5, r12: 6 })
  })

  it('ties share a weight', () => {
    const tied = [row('a', 7, 1300), row('b', 8, 1300), row('c', 9, 1200)]
    const w = Object.fromEntries(buildEligibleTeamsWithOdds(tied, 'inverse_points_for').map((t) => [t.rosterId, t.weight]))
    expect(w).toEqual({ a: 1, b: 1, c: 3 })
  })

  it('[control] no mode ever hands every team the same odds on a real pool', () => {
    for (const mode of ['inverse_standings', 'inverse_points_for', 'inverse_max_pf'] as const) {
      expect(new Set(Object.values(odds(mode))).size).toBeGreaterThan(1)
    }
  })

  it('a single row with no pool still weighs 1', () => {
    expect(computeWeight(row('solo', 9, 1500), 'inverse_points_for', 9, 9)).toBe(1)
    expect(computeWeight(row('solo', 9, 1500), 'inverse_standings', 9, 9)).toBe(1)
  })
})
