import { describe, expect, it, vi } from 'vitest'

import { backfillTradeFaab, TRADE_FAAB_BACKFILL_LIMIT, tradeFaabBackfillSql } from '@/lib/trade-market/tradeFaabBackfill'
import { bookKey, faabOfTradeRow, gatherFormatObservations } from '@/lib/trade-market/formatMarkets'
import { runScheduledMarketRecalc } from '@/lib/trade-market/scheduledMarketRecalc'

/**
 * FAAB for old seasons (owner's call, 2026-11-22): older Sleeper trades were stored without the FAAB they moved; the
 * transaction warehouse kept it. Filled onto empty rows only, only where unambiguous, and read by the learners.
 *
 * The UPDATE itself was run against a throwaway Postgres 16 with fixtures for each case (historical net, live in/out,
 * read zero, three-team, disagreeing facts, a fact with no FAAB field, an already-filled row, a non-Sleeper row) —
 * five rows filled, the rest untouched, and a second run filled nothing. These tests pin the guards that made that so.
 */

const NOW = new Date('2026-11-22T12:00:00Z')

describe('the backfill', () => {
  it('fills only empty Sleeper rows of two-roster trades whose own side\'s facts agree, newest first, bounded', () => {
    const q = tradeFaabBackfillSql(123)
    const sql = q.sql.replace(/\s+/g, ' ')
    expect(sql).toContain(`lt.platform = 'sleeper'`)
    expect(sql).toContain(`lt."budgetGiven" IS NULL AND lt."budgetReceived" IS NULL`)
    expect(sql).toContain('p.rosters = 2 AND p.all_read')
    expect(sql).toContain(`f.roster <> lt."partnerRosterId"::text`)
    expect(sql).toContain('HAVING count(DISTINCT f.net) = 1')
    expect(sql).toContain('ORDER BY max(lt."tradeDate") DESC NULLS LAST')
    // Received is the positive part of the net, given the negative part — never a stored -0.
    expect(sql).toContain('"budgetReceived" = GREATEST(target.net, 0), "budgetGiven" = ABS(LEAST(target.net, 0))')
    expect(q.values).toEqual([123])
  })

  it('reads both shapes: the historical net and the live in/out', () => {
    const sql = tradeFaabBackfillSql(1).sql
    expect(sql).toContain(`COALESCE((payload->>'faabIn')::float, 0) - COALESCE((payload->>'faabOut')::float, 0)`)
    expect(sql).toContain(`COALESCE((payload->>'faabNet')::float, 0)`)
  })

  it('one statement per run; TRADE_FAAB_BACKFILL=off runs nothing', async () => {
    const db = { $executeRaw: vi.fn(async () => 7) }
    expect(await backfillTradeFaab(db as never, { env: {} })).toEqual({ rowsFilled: 7 })
    expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    expect((db.$executeRaw.mock.calls[0] as unknown[])[0]).toMatchObject({ values: [TRADE_FAAB_BACKFILL_LIMIT] })
    const off = { $executeRaw: vi.fn() }
    expect(await backfillTradeFaab(off as never, { env: { TRADE_FAAB_BACKFILL: 'off' } })).toEqual({ off: true, rowsFilled: 0 })
    expect(off.$executeRaw).not.toHaveBeenCalled()
  })
})

describe('the learners read it', () => {
  const facts = [{ faabIn: 0, faabOut: 35, playersInIds: ['7'], playersOutIds: [] }, { faabIn: 35, faabOut: 0, playersInIds: [], playersOutIds: ['7'] }]

  it('a row\'s own stored FAAB first; the transaction facts when the row has none; a half-stored row is not trusted', () => {
    expect(faabOfTradeRow({ playersGiven: [], playersReceived: ['7'], budgetGiven: 20, budgetReceived: 0 }, facts)).toEqual({ given: 20, received: 0 })
    expect(faabOfTradeRow({ playersGiven: [], playersReceived: ['7'], budgetGiven: null, budgetReceived: null }, facts)).toEqual({ given: 35, received: 0 })
    expect(faabOfTradeRow({ playersGiven: [], playersReceived: ['7'], budgetGiven: 20, budgetReceived: null }, facts)).toEqual({ given: 35, received: 0 })
    expect(faabOfTradeRow({ playersGiven: [], playersReceived: ['7'], budgetGiven: 20, budgetReceived: 0 }, undefined)).toEqual({ given: 20, received: 0 })
    expect(faabOfTradeRow({ playersGiven: [], playersReceived: ['7'] }, undefined)).toBeNull()
  })

  it('an older trade priced with the FAAB on its own row: a 2027 1st plus $50 for a player', async () => {
    const tradeDay = Date.UTC(2026, 9, 10)
    const prisma = {
      leagueTrade: {
        findMany: async () => [{
          transactionId: 't', historyId: 'h', season: 2026, tradeDate: new Date(tradeDay + 3600_000),
          playersGiven: [], playersReceived: ['2'], picksGiven: [{ season: 2027, round: 1 }], picksReceived: [],
          budgetGiven: 50, budgetReceived: 0,
        }],
      },
      leagueTradeHistory: { findMany: async () => [{ id: 'h', sleeperLeagueId: 'P' }] },
      league: { findMany: async () => [{ id: 'L', platformLeagueId: 'P', leagueType: 'dynasty', settings: { waiver_budget: 100, roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'WR', 'TE'] } }] },
      leagueSeason: { findMany: async () => [] },
      leagueDynastySeason: { findMany: async () => [] },
      $queryRaw: async (q: { sql: string; values: unknown[] }) => {
        if (q.sql.includes('date_trunc')) return q.values[0] === 'DYNASTY' && q.values[1] === 'SUPERFLEX' ? [{ day: new Date(tradeDay) }] : []
        if (!q.sql.includes('PlayerValueSnapshot')) return [] // no transaction facts at all: only the row can say
        const [ids] = q.values as [string[]]
        return ids.map((id) => ({ sleeperId: id, value: 3000 }))
      },
      playerValueSnapshot: {
        findMany: async (a: { where: { sleeperId: { in: string[] }; capturedAt: { gte: Date } } }) =>
          a.where.capturedAt.gte.getTime() === tradeDay ? a.where.sleeperId.in.map((id) => ({ sleeperId: id, value: 1300 })) : [],
      },
      sportsPlayer: { findMany: async () => [] },
    }
    const g = await gatherFormatObservations(prisma as never, { sinceSeason: 2024, now: NOW })
    const obs = g.byBookPicks.get(bookKey({ format: 'DYNASTY', qbFormat: 'SUPERFLEX' }))!.observations
    expect(obs).toHaveLength(1)
    // The pick had to make up the player (1300) minus the $50 this side also paid.
    expect(obs[0]!.y).toBeLessThan(1300)
    expect(g.skipped.faab_priced).toBe(1)
  })
})

describe('the scheduled run', () => {
  it('fills FAAB first, so the same run\'s markets price it; a failed pass is reported, never thrown', async () => {
    const order: string[] = []
    const recalc = vi.fn(async () => {
      order.push('recalc')
      return { books: [], pickMarkets: [], postureMarkets: [], needMarkets: [], lineup: { factors: [] } as never, lineupWritten: false, tradesUsed: 0, tradesStamped: 0, skipped: {} }
    })
    const faabBackfill = vi.fn(async () => {
      order.push('faab')
      return { rowsFilled: 12 }
    })
    const deps = { now: NOW, recalc: recalc as never, writeLineup: vi.fn() as never, stampAll: vi.fn(async () => null) as never }
    const r = await runScheduledMarketRecalc({} as never, { ...deps, faabBackfill: faabBackfill as never })
    expect(order[0]).toBe('faab')
    expect(r.faabBackfill).toEqual({ rowsFilled: 12 })
    const failed = await runScheduledMarketRecalc({} as never, { ...deps, faabBackfill: vi.fn(async () => { throw new Error('x') }) as never })
    expect(failed.faabBackfill).toBeNull()
  })
})
