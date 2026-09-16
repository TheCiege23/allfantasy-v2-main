// @vitest-environment node
/**
 * The exposure breakdown's core (user decisions, 2026-09-14): your win chance in one
 * matchup now vs. with one of your starters scoring 0 — through the SAME model the
 * Matchup screen uses, never a second one.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { sidesWithoutPlayer, winImpactFor } from '@/lib/core-app/playerLeagueImpact'
import {
  NO_LIVE_POINTS,
  projectedFinalFor,
  winProbabilityFor,
  type LivePoints,
  type SideProjections,
} from '@/lib/core-app/matchupProjections'

const starter = (playerId: string, projectedPoints: number) => ({ playerId, projectedPoints, actualPoints: 0, isFinal: false })

function sides(over: Partial<SideProjections> = {}): SideProjections {
  return {
    you: {
      starters: [starter('A', 22), starter('B', 14), starter('C', 11)],
      unprojected: 0,
      projectedRemaining: 47,
      lineup: [
        { playerId: 'A', projected: 22 },
        { playerId: 'B', projected: 14 },
        { playerId: 'C', projected: 11 },
      ],
    },
    opponent: {
      starters: [starter('X', 20), starter('Y', 15), starter('Z', 10)],
      unprojected: 0,
      projectedRemaining: 45,
      lineup: [
        { playerId: 'X', projected: 20 },
        { playerId: 'Y', projected: 15 },
        { playerId: 'Z', projected: 10 },
      ],
    },
    leagueScoring: { available: true },
    ...over,
  }
}

const ZERO = NO_LIVE_POINTS

describe('winImpactFor', () => {
  it('🛑 prices "now" with exactly the Matchup screen\'s model, and "without" lower', () => {
    const impact = winImpactFor(sides(), ZERO, 'A')
    expect(impact.kind).toBe('priced')
    if (impact.kind !== 'priced') return
    const screen = winProbabilityFor(sides(), ZERO)
    expect(screen.available && impact.now).toBe(screen.available ? screen.data.pWin : false)
    expect(impact.without).toBeLessThan(impact.now)
  })

  it('a bigger projection costs more win chance when it goes to zero', () => {
    const a = winImpactFor(sides(), ZERO, 'A')
    const c = winImpactFor(sides(), ZERO, 'C')
    if (a.kind !== 'priced' || c.kind !== 'priced') throw new Error('expected both priced')
    expect(a.now - a.without).toBeGreaterThan(c.now - c.without)
  })

  it('a player on the roster but not in the lineup changes nothing, and says so', () => {
    expect(winImpactFor(sides(), ZERO, 'BENCHED')).toEqual({ kind: 'not_starting' })
  })

  it('🛑 an unpriceable matchup returns the model\'s reason, never a number', () => {
    const unpriced = sides({
      you: { ...sides().you, unprojected: 1, lineup: [...sides().you.lineup, { playerId: 'D', projected: null }] },
    })
    const impact = winImpactFor(unpriced, ZERO, 'A')
    expect(impact.kind).toBe('unpriced')
    if (impact.kind === 'unpriced') expect(impact.reason).toMatch(/could not be priced/)

    const noRules = sides({ leagueScoring: { available: false, reason: 'we hold no scoring settings for this league' } })
    expect(winImpactFor(noRules, ZERO, 'A')).toEqual({ kind: 'unpriced', reason: 'we hold no scoring settings for this league' })
  })

  it('mid-game, points already banked stay: only his remaining projection is removed', () => {
    // A has 30 (past his 22), B has 10 of his 14, the opponent's X has 38.
    const live: LivePoints = {
      team: { you: 40, opponent: 38 },
      byPlayer: new Map([['A', 30], ['B', 10], ['X', 38]]),
    }
    const impact = winImpactFor(sides(), live, 'B')
    if (impact.kind !== 'priced') throw new Error('expected priced')
    const nowCheck = winProbabilityFor(sides(), live)
    expect(nowCheck.available && nowCheck.data.pWin).toBe(impact.now)
    expect(impact.without).toBeLessThan(impact.now)

    // His 10 stay on the board; only his last 4 go. 40 banked + C's 11 + B's 4 → 55; without B → 51.
    const final = projectedFinalFor(sides(), live)
    const finalWithout = projectedFinalFor(sidesWithoutPlayer(sides(), 'B'), live)
    expect(final.available && final.data.you).toBe(55)
    expect(finalWithout.available && finalWithout.data.you).toBe(51)
  })
})

describe('sidesWithoutPlayer', () => {
  it('zeroes only that starter on your side, keeps him in the lineup, and never mutates', () => {
    const input = sides()
    const snapshot = JSON.stringify(input)
    const out = sidesWithoutPlayer(input, 'B')
    expect(out.you.starters.map((p) => [p.playerId, p.projectedPoints])).toEqual([
      ['A', 22],
      ['B', 0],
      ['C', 11],
    ])
    expect(out.you.lineup).toEqual(input.you.lineup)
    expect(out.opponent).toEqual(input.opponent)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
