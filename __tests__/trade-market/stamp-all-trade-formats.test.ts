import { describe, expect, it, vi } from 'vitest'

import { stampAllTradeFormats, STAMP_ALL_HISTORY_LIMIT } from '@/lib/trade-market/formatMarkets'
import { runScheduledMarketRecalc } from '@/lib/trade-market/scheduledMarketRecalc'

/**
 * The census "league-type gap" (owner's call, 2026-11-22): trades older than the market's own window were never given a
 * league type — at least 10,898 of the 11,761 unlabelled NFL trades were 2018–2023. Every season's unlabelled trades are
 * now resolved through the same lookup the market uses and labelled by history; only empty rows are written.
 */

type W = { where: Record<string, { in?: string[] }> }
const inList = (w: W, key: string) => w.where[key]?.in ?? []

function fakePrisma() {
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = []
  const histories = [
    { id: 'h-sf', sleeperLeagueId: 'P-SF' },
    { id: 'h-2021', sleeperLeagueId: 'P-2021' },
    { id: 'h-gone', sleeperLeagueId: 'P-GONE' },
  ]
  const leagues = [
    { id: 'L-SF', platformLeagueId: 'P-SF', leagueType: 'dynasty', settings: { roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'] } },
    { id: 'L-NOW', platformLeagueId: 'P-NOW', leagueType: 'redraft', settings: { roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'] } },
  ]
  const queries: string[] = []
  return {
    updates,
    queries,
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      queries.push(q.sql)
      return histories.map((h) => ({ historyId: h.id }))
    },
    leagueTradeHistory: { findMany: async (a: W) => histories.filter((h) => inList(a, 'id').includes(h.id)) },
    league: {
      findMany: async (a: W) =>
        a.where.platformLeagueId ? leagues.filter((l) => inList(a, 'platformLeagueId').includes(l.platformLeagueId)) : leagues.filter((l) => inList(a, 'id').includes(l.id)),
    },
    // The 2021 season of a league that is a 1QB redraft league TODAY — but that season was a 2QB dynasty league.
    leagueDynastySeason: {
      findMany: async (a: W) =>
        inList(a, 'platformLeagueId').includes('P-2021')
          ? [{ platformLeagueId: 'P-2021', leagueId: 'L-NOW', metadata: { rosterPositions: ['QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN'], rawSettings: { type: 2, max_keepers: 0 } } }]
          : [],
    },
    leagueSeason: { findMany: async () => [] },
    leagueTrade: {
      updateMany: vi.fn(async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updates.push(a)
        return { count: (a.where.historyId as { in: string[] }).in.length * 3 }
      }),
    },
  }
}

describe('every season\'s unlabelled trades get a league type', () => {
  it('resolves through the current league and through the season\'s own settings; an unresolvable one is counted, not guessed', async () => {
    const db = fakePrisma()
    const r = await stampAllTradeFormats(db as never)
    expect(r).toEqual({ histories: 3, resolved: 2, unresolved: 1, rowsStamped: 6 })
    const byHistory = Object.fromEntries(db.updates.flatMap((u) => (u.where.historyId as { in: string[] }).in.map((h) => [h, u.data])))
    expect(byHistory['h-sf']).toEqual({ leagueFormat: 'dynasty', isSuperFlex: true })
    // Read on THAT season's 2QB dynasty settings, not today's 1QB redraft ones.
    expect(byHistory['h-2021']).toEqual({ leagueFormat: 'dynasty', isSuperFlex: true })
    expect(byHistory['h-gone']).toBeUndefined()
  })

  it('writes only empty rows, and draws the histories at random within the limit so an unresolvable one never blocks the rest', async () => {
    const db = fakePrisma()
    await stampAllTradeFormats(db as never)
    expect(db.updates.every((u) => u.where.leagueFormat === null)).toBe(true)
    expect(db.queries[0]).toMatch(/"leagueFormat" IS NULL/)
    expect(db.queries[0]).toMatch(/ORDER BY random\(\)/)
    expect(STAMP_ALL_HISTORY_LIMIT).toBeGreaterThan(0)
  })

  it('nothing unlabelled: nothing read beyond the draw, nothing written', async () => {
    const db = { ...fakePrisma(), $queryRaw: async () => [] }
    expect(await stampAllTradeFormats(db as never)).toEqual({ histories: 0, resolved: 0, unresolved: 0, rowsStamped: 0 })
    expect(db.leagueTrade.updateMany).not.toHaveBeenCalled()
  })
})

describe('the daily recalc runs it last, and survives it failing', () => {
  const recalc = vi.fn(async () => ({ books: [], lineup: { factors: [] }, lineupWritten: false, tradesUsed: 0, tradesStamped: 0, skipped: {} }))

  it('reports the pass, or null when it threw', async () => {
    const ok = await runScheduledMarketRecalc({} as never, { recalc: recalc as never, writeLineup: vi.fn() as never, stampAll: async () => ({ histories: 9, resolved: 7, unresolved: 2, rowsStamped: 40 }) })
    expect(ok.formatBackfill).toEqual({ histories: 9, resolved: 7, unresolved: 2, rowsStamped: 40 })
    const failed = await runScheduledMarketRecalc({} as never, { recalc: recalc as never, writeLineup: vi.fn() as never, stampAll: async () => { throw new Error('boom') } })
    expect(failed.formatBackfill).toBeNull()
  })
})
