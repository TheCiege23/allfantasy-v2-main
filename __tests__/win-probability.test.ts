import { describe, expect, it } from 'vitest'
import {
  computeWinProbability,
  projectedStdDev,
  type MatchupSide,
} from '@/lib/projections/winProbability'

function player(id: string, proj: number | null, actual = 0, isFinal = false) {
  return { playerId: id, projectedPoints: proj, actualPoints: actual, isFinal }
}

function side(teamId: string, starters: ReturnType<typeof player>[]): MatchupSide {
  return { teamId, starters }
}

describe('projectedStdDev — fitted to real games, not a flat CV', () => {
  it('gives studs a LOWER coefficient of variation than dart throws', () => {
    // The measured pattern: cv 1.32 at the bottom, 0.45 at the top. A flat
    // multiplier would invert the relative volatility of both tails.
    const lowCv = projectedStdDev(4) / 4
    const highCv = projectedStdDev(20) / 20
    expect(highCv).toBeLessThan(lowCv)
  })

  it('is zero for a player projected to score nothing', () => {
    expect(projectedStdDev(0)).toBe(0)
    expect(projectedStdDev(-5)).toBe(0)
  })

  it('lands near the measured value for a 15-point starter', () => {
    // Observed: mean 15.0 -> sd 6.8.
    expect(projectedStdDev(15)).toBeGreaterThan(5.5)
    expect(projectedStdDev(15)).toBeLessThan(8)
  })
})

describe('win probability', () => {
  it('is 50% between identical teams with everything still to play', () => {
    const a = side('a', [player('1', 15), player('2', 12)])
    const b = side('b', [player('3', 15), player('4', 12)])
    const r = computeWinProbability(a, b)
    expect(r.available).toBe(true)
    if (!r.available) return
    expect(r.pWin).toBeCloseTo(0.5, 2)
  })

  it('distinguishes a lead with everything left from the same lead with nothing left', () => {
    // The exact failure a points ratio cannot represent: identical scoreline,
    // completely different position.
    const leadEarly = computeWinProbability(
      side('a', [player('1', 30, 30, true), player('2', 15)]),
      side('b', [player('3', 15), player('4', 15)])
    )
    const leadLate = computeWinProbability(
      side('a', [player('1', 30, 30, true), player('2', 15, 15, true)]),
      side('b', [player('3', 15, 15, true), player('4', 15, 0, true)])
    )
    expect(leadEarly.available && leadLate.available).toBe(true)
    if (!leadEarly.available || !leadLate.available) return
    // Same 15-point margin; the settled one must be far more certain.
    expect(leadLate.pWin).toBeGreaterThan(leadEarly.pWin)
    expect(leadLate.marginStdDev).toBe(0)
  })

  it('collapses to a certainty once every starter is final', () => {
    const r = computeWinProbability(
      side('a', [player('1', 20, 22, true)]),
      side('b', [player('2', 20, 18, true)])
    )
    if (!r.available) return
    expect(r.pWin).toBe(1)
    expect(r.confidence).toBe('HIGH')
    expect(r.detail).toContain('final')
  })

  it('counts only the REMAINDER of a mid-game player as uncertain', () => {
    // A player projected 20 who already has 18 has almost nothing left to give;
    // treating the full 20 as outstanding would double-count the board.
    //
    // Both sides here project to the same TOTAL (18 banked + 2 left vs 20 left),
    // so 50% is correct — what differs is the uncertainty, and that is the
    // property worth asserting.
    const nearlyDone = computeWinProbability(
      side('a', [player('1', 20, 18)]),
      side('b', [player('2', 20, 0)])
    )
    if (!nearlyDone.available) return
    expect(nearlyDone.remainingProjected).toBeCloseTo(22, 0)
    expect(nearlyDone.pWin).toBeCloseTo(0.5, 2)

    // The same 20-point expectation with NOTHING banked carries far more spread.
    const allToCome = computeWinProbability(
      side('a', [player('1', 20, 0)]),
      side('b', [player('2', 20, 0)])
    )
    if (!allToCome.available) return
    expect(nearlyDone.marginStdDev).toBeLessThan(allToCome.marginStdDev)
  })

  it('favours the side whose points are already banked over an equal projection', () => {
    // 18 banked + 2 to come, against an opponent still needing all 19.
    const r = computeWinProbability(
      side('a', [player('1', 20, 18)]),
      side('b', [player('2', 19, 0)])
    )
    if (!r.available) return
    expect(r.pWin).toBeGreaterThan(0.5)
  })

  it('never claims HIGH confidence while scoring remains', () => {
    const r = computeWinProbability(
      side('a', [player('1', 40)]),
      side('b', [player('2', 5)])
    )
    if (!r.available) return
    // Lopsided, but it still rests on the independence assumption.
    expect(r.pWin).toBeGreaterThan(0.9)
    expect(r.confidence).not.toBe('HIGH')
  })

  describe('refuses rather than tilting the result', () => {
    it('will not compute when a starter still to play has no projection', () => {
      // Zero expected AND zero variance reads as "certain to score nothing",
      // which silently favours the fully-covered side.
      const r = computeWinProbability(
        side('a', [player('1', 15), player('2', null)]),
        side('b', [player('3', 15), player('4', 12)])
      )
      expect(r.available).toBe(false)
      if (r.available) return
      expect(r.reason).toContain('no projection')
    })

    it('ignores a missing projection once that player is final', () => {
      // Their score is known, so the absent projection no longer matters.
      const r = computeWinProbability(
        side('a', [player('1', 15), player('2', null, 9, true)]),
        side('b', [player('3', 15), player('4', 12)])
      )
      expect(r.available).toBe(true)
    })

    it('will not compute for an empty lineup', () => {
      const r = computeWinProbability(side('a', []), side('b', [player('1', 10)]))
      expect(r.available).toBe(false)
    })
  })
})
