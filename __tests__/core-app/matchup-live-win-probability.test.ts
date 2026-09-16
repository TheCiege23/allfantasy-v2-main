// @vitest-environment node
/**
 * Live-week win odds and projected final (scoring audit, 2026-09-16).
 *
 * The model takes each starter's remaining projection as `max(0, projected − actual)`, so the
 * points on the board have to reach it PER PLAYER. They used to arrive as one team total pinned
 * to whichever starter was listed first: that starter's projection absorbed the whole total and
 * every other starter — including one who had already beaten his projection — still counted his
 * full projection as still to come.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  LIVE_SCORES_UNATTRIBUTED_REASON,
  NO_LIVE_POINTS,
  projectedFinalFor,
  winProbabilityFor,
  type LivePoints,
  type SideProjection,
  type SideProjections,
} from '@/lib/core-app/matchupProjections'
import { computeWinProbability } from '@/lib/projections/winProbability'

type Slot = [playerId: string, projected: number | null]

function side(slots: Slot[]): SideProjection {
  const priced = slots.filter((s): s is [string, number] => s[1] != null)
  return {
    starters: priced.map(([playerId, projectedPoints]) => ({ playerId, projectedPoints, actualPoints: 0, isFinal: false })),
    unprojected: slots.length - priced.length,
    projectedRemaining: priced.reduce((sum, [, p]) => sum + p, 0),
    lineup: slots.map(([playerId, projected]) => ({ playerId, projected })),
  }
}

// The audit's lineup: a 20-point QB listed FIRST, then a WR projected 14; the other four add 76.
const YOU: Slot[] = [['QB', 20], ['WR', 14], ['RB', 30], ['TE', 26], ['K', 10], ['DEF', 10]]
const OPP: Slot[] = [['oQB', 22], ['oWR', 18], ['oRB', 28], ['oTE', 22], ['oK', 10], ['oDEF', 10]]

const sides = (you: Slot[] = YOU, opponent: Slot[] = OPP): SideProjections => ({
  you: side(you),
  opponent: side(opponent),
  leagueScoring: { available: true },
})

const live = (you: number, opponent: number, rows: Array<[string, number]> | null): LivePoints => ({
  team: { you, opponent },
  byPlayer: rows ? new Map(rows) : null,
})

function final(s: SideProjections, l: LivePoints) {
  const r = projectedFinalFor(s, l)
  if (!r.available) throw new Error(r.reason)
  return r.data
}

function odds(s: SideProjections, l: LivePoints) {
  const r = winProbabilityFor(s, l)
  if (!r.available) throw new Error(r.reason)
  return r.data
}

// Every opponent starter has a row at 0: that side is ingested and has not scored yet.
const OPP_ROWS: Array<[string, number]> = OPP.map(([id]) => [id, 0])

describe('before kickoff', () => {
  it('is the plain projected totals, and exactly the model’s own number', () => {
    expect(final(sides(), NO_LIVE_POINTS)).toEqual({ you: 110, opponent: 110 })
    const s = sides()
    const direct = computeWinProbability(
      { teamId: 'you', starters: s.you.starters },
      { teamId: 'opponent', starters: s.opponent.starters },
    )
    if (!direct.available) throw new Error(direct.reason)
    const got = odds(s, NO_LIVE_POINTS)
    expect(got.pWin).toBe(direct.pWin)
    expect(got.projectedMargin).toBe(0)
  })

  it('zero on both boards with no rows is simply pre-game, not a refusal', () => {
    expect(final(sides(), live(0, 0, null))).toEqual({ you: 110, opponent: 110 })
    expect(odds(sides(), live(0, 0, null))).toEqual(odds(sides(), NO_LIVE_POINTS))
  })
})

describe('mid-slate', () => {
  it('🛑 a starter who has beaten his projection adds nothing more — 121, not 115', () => {
    const l = live(25, 0, [['QB', 0], ['WR', 25], ['RB', 0], ['TE', 0], ['K', 0], ['DEF', 0], ...OPP_ROWS])
    // 25 banked + QB 20 + WR 0 more + the other four's 76.
    expect(final(sides(), l)).toEqual({ you: 121, opponent: 110 })
    expect(odds(sides(), l).projectedMargin).toBe(11)
    expect(odds(sides(), l).pWin).toBeGreaterThan(odds(sides(), NO_LIVE_POINTS).pWin)
  })

  it('🛑 the lineup ORDER cannot move the number', () => {
    const l = live(25, 0, [['WR', 25], ...OPP_ROWS])
    const qbFirst = odds(sides(YOU), l)
    const wrFirst = odds(sides([YOU[1], YOU[0], ...YOU.slice(2)]), l)
    const reversed = odds(sides([...YOU].reverse()), l)
    expect(wrFirst).toEqual(qbFirst)
    expect(reversed).toEqual(qbFirst)
  })

  it('a starter still playing keeps only what is left of his projection', () => {
    // RB has 12 of his 30: 18 to come. 12 banked + 20 + 14 + 18 + 26 + 10 + 10 = 110.
    const l = live(12, 0, [['RB', 12], ...OPP_ROWS])
    expect(final(sides(), l)).toEqual({ you: 110, opponent: 110 })
  })

  it('⚠ the scoreboard is the authority when it is AHEAD of the player rows', () => {
    // 15 of the 40 are not in any row yet: banked once, never dropped.
    const l = live(40, 0, [['WR', 25], ...OPP_ROWS])
    expect(final(sides(), l)).toEqual({ you: 136, opponent: 110 })
    expect(odds(sides(), l).projectedMargin).toBe(26)
  })

  it('⚠ when the player rows are AHEAD of the scoreboard, their sum stands and nothing counts twice', () => {
    const l = live(20, 0, [['WR', 25], ...OPP_ROWS])
    expect(final(sides(), l)).toEqual({ you: 121, opponent: 110 })
    expect(odds(sides(), l).projectedMargin).toBe(11)
  })

  it('an opponent who is ahead is priced from his own rows too', () => {
    const l = live(0, 30, [['QB', 0], ['oWR', 30], ['oQB', 0]])
    // 30 banked + 22 + 0 more from oWR + 28 + 22 + 10 + 10.
    expect(final(sides(), l)).toEqual({ you: 110, opponent: 122 })
    expect(odds(sides(), l).projectedMargin).toBe(-12)
  })

  it('points scored by a starter we cannot price still count toward the projected final', () => {
    const unpriced: Slot[] = [...YOU.slice(0, 5), ['DEF', null]]
    const l = live(8, 0, [['DEF', 8], ...OPP_ROWS])
    // 8 banked + the five priced starters' 100; the defence adds nothing we can project.
    expect(final(sides(unpriced), l)).toEqual({ you: 108, opponent: 110 })
    // …and the odds still refuse, for the unpriced starter rather than the live score.
    const r = winProbabilityFor(sides(unpriced), l)
    expect(r.available).toBe(false)
    if (!r.available) expect(r.reason).toMatch(/could not be priced/)
  })
})

describe('🛑 points on the board with no per-player scores are refused, never guessed', () => {
  const refuses = (l: LivePoints) => {
    expect(projectedFinalFor(sides(), l)).toEqual({ available: false, reason: LIVE_SCORES_UNATTRIBUTED_REASON })
    expect(winProbabilityFor(sides(), l)).toEqual({ available: false, reason: LIVE_SCORES_UNATTRIBUTED_REASON })
  }

  it('no rows read at all', () => refuses(live(25, 0, null)))
  it('an empty row set', () => refuses(live(25, 0, [])))
  it('only the opponent has scored', () => refuses(live(0, 12, null)))
  it('a negative total is still points on the board', () => refuses(live(-2, 0, null)))

  it('⚠ rows for ONE side do not cover the other side’s total', () => {
    // Your side is ingested; the opponent's 30 has no row behind it, so its starters' remaining is unknowable.
    refuses(live(25, 30, [['WR', 25]]))
  })

  it('rows for players outside the lineup do not count as coverage', () => {
    refuses(live(0, 30, [['someone-on-the-bench', 30], ['QB', 0]]))
  })
})
