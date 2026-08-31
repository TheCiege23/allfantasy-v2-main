/**
 * Deriving Fantrax transactions from roster diffs.
 *
 * 🛑 WHY THIS IS DERIVED AT ALL: Fantrax publishes no transactions endpoint —
 * the word does not appear in its documentation — so a roster diff across
 * scoring periods is the only route to trade and waiver history from the API.
 *
 * ⚠ THE TESTS THAT MATTER MOST ARE THE ONES ASSERTING WHAT IS *NOT* CLAIMED. A
 * diff observes that a player changed hands and never observes why, so the risk
 * is not missing a move — it is confidently reporting a trade that never
 * happened. The one-way-movement case below is the guard on that.
 */

import { describe, expect, it } from 'vitest'

import {
  deriveFantraxTransactions,
  type PeriodRoster,
} from '@/lib/league-import/fantrax/deriveFantraxTransactions'

const team = (teamName: string, playerIds: string[]) => ({ teamName, playerIds })

describe('deriveFantraxTransactions', () => {
  it('reports an add and a drop against the period they appeared in', () => {
    const periods: PeriodRoster[] = [
      { period: 1, teams: { t1: team('Ciege82', ['a', 'b', 'c']) } },
      { period: 2, teams: { t1: team('Ciege82', ['a', 'b', 'd']) } },
    ]

    const out = deriveFantraxTransactions(periods)

    expect(out.moves).toHaveLength(1)
    expect(out.moves[0]).toMatchObject({ period: 2, teamId: 't1', adds: ['d'], drops: ['c'] })
  })

  it('emits nothing for a roster that did not change', () => {
    const out = deriveFantraxTransactions([
      { period: 1, teams: { t1: team('A', ['a', 'b']) } },
      { period: 2, teams: { t1: team('A', ['b', 'a']) } },
    ])
    /* Order is not a move. */
    expect(out.moves).toEqual([])
    expect(out.suspectedTrades).toEqual([])
  })

  it('suspects a trade only on a genuine two-way exchange', () => {
    const out = deriveFantraxTransactions([
      { period: 1, teams: { t1: team('A', ['x', 'keep1']), t2: team('B', ['y', 'keep2']) } },
      { period: 2, teams: { t1: team('A', ['y', 'keep1']), t2: team('B', ['x', 'keep2']) } },
    ])

    expect(out.suspectedTrades).toHaveLength(1)
    expect(out.suspectedTrades[0]).toMatchObject({
      period: 2,
      teamAName: 'A',
      teamBName: 'B',
      aSent: ['x'],
      bSent: ['y'],
    })
  })

  /**
   * 🛑 THE GUARD THAT MATTERS. Team A drops a player and team B picks him up in
   * the same period — the signature of a WAIVER CLAIM on a dropped player, which
   * is the single most common event in an active league. Counting it as a trade
   * would manufacture a trade for every claim, so the exchange must be two-way
   * before anything is suspected.
   */
  it('does NOT call one-way movement a trade — that is a waiver claim', () => {
    const out = deriveFantraxTransactions([
      { period: 1, teams: { t1: team('A', ['x', 'keep1']), t2: team('B', ['keep2']) } },
      { period: 2, teams: { t1: team('A', ['keep1']), t2: team('B', ['keep2', 'x']) } },
    ])

    /* The movement is still reported as a drop and an add — it happened. */
    expect(out.moves).toHaveLength(2)
    /* But nothing is claimed about WHY. */
    expect(out.suspectedTrades).toEqual([])
  })

  it('records a period gap rather than presenting the net change as complete', () => {
    const out = deriveFantraxTransactions([
      { period: 1, teams: { t1: team('A', ['a']) } },
      { period: 4, teams: { t1: team('A', ['b']) } },
    ])

    expect(out.gapsSkipped).toEqual([[1, 4]])
    /* The net change is still surfaced — it is real — but the caller now knows
       anything added AND dropped inside the gap is invisible. */
    expect(out.moves[0]).toMatchObject({ adds: ['b'], drops: ['a'] })
  })

  it('is not sensitive to the order periods were fetched in', () => {
    const forward = deriveFantraxTransactions([
      { period: 1, teams: { t1: team('A', ['a']) } },
      { period: 2, teams: { t1: team('A', ['b']) } },
    ])
    const reversed = deriveFantraxTransactions([
      { period: 2, teams: { t1: team('A', ['b']) } },
      { period: 1, teams: { t1: team('A', ['a']) } },
    ])
    expect(reversed).toEqual(forward)
  })

  /**
   * ⚠ A TEAM PRESENT IN ONLY ONE SNAPSHOT IS NOT A ROSTER MOVE. That is an
   * expansion, a fold, or a failed fetch — treating its whole roster as adds
   * would report a dozen signings that never happened.
   */
  it('ignores a team that appears in only one of the two periods', () => {
    const out = deriveFantraxTransactions([
      { period: 1, teams: { t1: team('A', ['a']) } },
      { period: 2, teams: { t1: team('A', ['a']), t2: team('NewTeam', ['x', 'y', 'z']) } },
    ])
    expect(out.moves).toEqual([])
  })
})
