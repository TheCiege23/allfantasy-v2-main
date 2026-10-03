// @vitest-environment node
/**
 * The Trades board grades each league's latest trade in a BOUNDED POOL (2026-10-03).
 *
 * It was a sequential `for…await`: measured read-only against production, 40 leagues took 27.6s
 * cold and 4–5s warm, ~95% of the board, because each league's first grade builds that league's
 * chart. These pin the three properties the pool must keep: it actually overlaps leagues, it never
 * exceeds its bound, and a grade that finishes out of order still lands on ITS league's card.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ leagues: 10, inFlight: 0, maxInFlight: 0, finishOrder: [] as string[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/decision-os/trade/completedTradeGrade', () => ({
  completedTradeGraderFor: async () => ({}),
  gradeArchivedTrade: async (_grader: unknown, input: { original: { afLeagueId: string } }) => {
    const id = input.original.afLeagueId
    h.inFlight += 1
    h.maxInFlight = Math.max(h.maxInFlight, h.inFlight)
    // Later leagues finish FIRST, so completion order is the reverse of input order.
    const n = Number(id.slice(1))
    await new Promise((resolve) => setTimeout(resolve, (h.leagues - n) * 4))
    h.inFlight -= 1
    h.finishOrder.push(id)
    return { graded: false, reason: `ungraded-${id}`, basis: null }
  },
}))
vi.mock('@/lib/prisma', () => {
  const ids = Array.from({ length: h.leagues }, (_, i) => i)
  const rows: Record<string, (args: { where?: Record<string, unknown> }) => unknown[]> = {
    leagueTeam: (args) =>
      args.where?.claimedByUserId
        ? ids.map((i) => ({
            leagueId: `L${i}`,
            league: {
              id: `L${i}`,
              name: `League ${i}`,
              platform: 'sleeper',
              settings: {},
              leagueType: 'dynasty',
              platformLeagueId: `S${i}`,
              logoUrl: null,
              avatarUrl: null,
              userId: 'u1',
              updatedAt: new Date('2026-09-30T00:00:00Z'),
              season: 2026,
            },
          }))
        : [],
    leagueTradeHistory: () => ids.map((i) => ({ id: `H${i}`, sleeperLeagueId: `S${i}`, sleeperUsername: '111' })),
    leagueTrade: () =>
      ids.map((i) => ({
        transactionId: `T${i}`,
        historyId: `H${i}`,
        season: 2026,
        week: 3,
        tradeDate: new Date(Date.UTC(2026, 8, 20, i)),
        playersGiven: ['4046'],
        playersReceived: ['6794'],
        picksGiven: [],
        picksReceived: [],
        partnerName: null,
        partnerRosterId: null,
        platform: 'sleeper',
        sport: 'nfl',
      })),
  }
  const model = (name: string) => {
    const fn = (args: { where?: Record<string, unknown> }) => Promise.resolve(rows[name]?.(args) ?? [])
    return new Proxy(
      {},
      {
        get: (_t, op) =>
          op === 'findMany' ? fn : op === 'findFirst' || op === 'findUnique' ? () => Promise.resolve(null) : () => Promise.resolve([]),
      },
    )
  }
  const prisma = new Proxy({}, { get: (_t, name) => (name === '$queryRaw' || name === '$queryRawUnsafe' ? () => Promise.resolve([]) : model(String(name))) })
  return { prisma }
})

import { BOARD_GRADE_CONCURRENCY, getTradesBoard } from '@/lib/core-app/tradesBoard'

beforeEach(() => {
  h.inFlight = 0
  h.maxInFlight = 0
  h.finishOrder = []
})

describe('Trades board grading pool', () => {
  it('grades several leagues at once, and never more than its bound', async () => {
    await getTradesBoard('u1', 4)
    expect(h.finishOrder).toHaveLength(h.leagues)
    expect(h.maxInFlight).toBeGreaterThan(1)
    expect(h.maxInFlight).toBeLessThanOrEqual(BOARD_GRADE_CONCURRENCY)
  })

  it('🛑 a grade that finishes out of order still lands on its own league’s card', async () => {
    const board = await getTradesBoard('u1', 4)
    // The pool really did finish out of input order — otherwise this asserts nothing.
    expect(h.finishOrder).not.toEqual([...h.finishOrder].sort())
    const cards = board.windows.map((w) => [w.leagueId, w.latest?.transactionId, w.latest?.withheldReason])
    expect(cards).toHaveLength(h.leagues)
    for (const [leagueId, tx, reason] of cards) {
      const n = String(leagueId).slice(1)
      expect(tx).toBe(`T${n}`)
      expect(reason).toBe(`ungraded-L${n}`)
    }
  })
})
