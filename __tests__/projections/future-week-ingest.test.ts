import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FUTURE_WEEK_HORIZON,
  canonicalBoardLines,
  futureWeeksFor,
  hashBoardLines,
  ingestFutureWeeks,
} from '@/lib/projections/futureWeekIngest'
import type { FutureWeekStoreWriter } from '@/lib/projections/futureWeekProjectionStore'
import type { WeekBoard } from '@/lib/sports-data/sleeperMarketService'

/*
 * The future-week phase, with the board and the store both faked — no network, no database.
 *
 * Board rows follow the `WeekBoard` shape `getWeekBoard` builds (lib/sports-data/sleeperMarketService.ts)
 * and the Jayden Reed row already used by __tests__/cron/import-projections-cron.test.ts. There is no
 * committed Sleeper fixture to take them from (contracts/sleeper/GAPS.md).
 */

function board(week: number, players: Record<string, { pts?: number; stats?: Record<string, number>; opp?: string }>): WeekBoard {
  const out: WeekBoard = { version: 1, season: '2026', week, players: {} }
  for (const [id, p] of Object.entries(players)) {
    out.players[id] = {
      playerId: id,
      name: `Player ${id}`,
      position: 'WR',
      team: 'GB',
      opponent: p.opp ?? null,
      stats: { ...(p.stats ?? {}), ...(p.pts == null ? {} : { pts_ppr: p.pts }) },
    }
  }
  return out
}

function fakeStore(prior: Map<number, { payloadHash: string | null; status: string | null }> = new Map()) {
  const store = {
    readCheck: vi.fn(async (key: { week: number }) => prior.get(key.week) ?? null),
    replaceWeek: vi.fn(async (input: { lines: unknown[] }) => input.lines.length),
    confirmWeek: vi.fn(async () => undefined),
    recordWeekError: vi.fn(async () => undefined),
    pruneThrough: vi.fn(async () => 3),
  }
  return store as typeof store & FutureWeekStoreWriter
}

const FAR = () => Date.now() + 10 * 60_000

describe('futureWeeksFor', () => {
  it('covers the next four regular-season weeks and never the current one', () => {
    expect(FUTURE_WEEK_HORIZON).toBe(4)
    expect(futureWeeksFor(3)).toEqual([4, 5, 6, 7])
    expect(futureWeeksFor(16)).toEqual([17, 18])
    expect(futureWeeksFor(18)).toEqual([])
    expect(futureWeeksFor(3)).not.toContain(3)
  })
})

describe('board canonicalisation and hashing', () => {
  it('keeps only rows with a finite pts_ppr, sorted by player id', () => {
    const lines = canonicalBoardLines(board(4, { b: { pts: 7 }, a: { pts: 12.4, opp: 'CHI' }, c: { stats: { rec: 3 } } }))
    expect(lines.map((l) => l.playerId)).toEqual(['a', 'b'])
    expect(lines[0]).toMatchObject({ projectedPoints: 12.4, opponent: 'CHI' })
  })

  it('does not move with stat-key order, and does move when a number changes', () => {
    const one = canonicalBoardLines(board(4, { a: { pts: 12.4, stats: { rec: 5, rec_yd: 60 } } }))
    const reordered = canonicalBoardLines(board(4, { a: { pts: 12.4, stats: { rec_yd: 60, rec: 5 } } }))
    const changed = canonicalBoardLines(board(4, { a: { pts: 12.9, stats: { rec: 5, rec_yd: 60 } } }))
    expect(hashBoardLines(one)).toBe(hashBoardLines(reordered))
    expect(hashBoardLines(one)).not.toBe(hashBoardLines(changed))
  })
})

describe('ingestFutureWeeks', () => {
  let store: ReturnType<typeof fakeStore>
  beforeEach(() => {
    store = fakeStore()
  })

  it('writes each published future week, nearest first, and prunes through the current week', async () => {
    const getBoard = vi.fn(async (_s: string, w: number) => board(w, { '4046': { pts: 10 + w } }))
    const report = await ingestFutureWeeks({ sport: 'NFL', season: '2026', anchorWeek: 3, deadlineAt: FAR() }, { getBoard, store })

    expect(getBoard.mock.calls.map((c) => c[1])).toEqual([4, 5, 6, 7])
    expect(store.pruneThrough).toHaveBeenCalledWith({ sport: 'NFL', season: '2026', throughWeek: 3 })
    expect(store.replaceWeek.mock.calls.map((c) => (c[0] as { week: number }).week)).toEqual([4, 5, 6, 7])
    const first = store.replaceWeek.mock.calls[0]![0] as Record<string, unknown>
    expect(first).toMatchObject({ sport: 'NFL', season: '2026', week: 4, source: 'sleeper', anchorWeek: 3, scoringPresetId: 'ppr' })
    expect((first.lines as Array<{ projectedPoints: number }>)[0]!.projectedPoints).toBe(14)
    expect(typeof first.payloadHash).toBe('string')
    expect(report.weeks.map((w) => w.outcome)).toEqual(['written', 'written', 'written', 'written'])
    expect(report.pruned).toBe(3)
  })

  it('an unchanged board is confirmed, never rewritten (hash, not status, decides)', async () => {
    const b = board(4, { '4046': { pts: 14 } })
    const hash = hashBoardLines(canonicalBoardLines(b))
    store = fakeStore(new Map([[4, { payloadHash: hash, status: 'published' }]]))
    const report = await ingestFutureWeeks(
      { sport: 'NFL', season: '2026', anchorWeek: 3, horizon: 1, deadlineAt: FAR() },
      { getBoard: async () => b, store },
    )
    expect(store.replaceWeek).not.toHaveBeenCalled()
    expect(store.confirmWeek).toHaveBeenCalledWith(expect.objectContaining({ week: 4, status: 'published', payloadHash: hash, rowCount: 1 }))
    expect(report.weeks).toEqual([{ week: 4, outcome: 'unchanged', lines: 1 }])
  })

  it('a board with no projected points is "not published", not an error', async () => {
    const report = await ingestFutureWeeks(
      { sport: 'NFL', season: '2026', anchorWeek: 3, horizon: 1, deadlineAt: FAR() },
      { getBoard: async (_s, w) => board(w, { '4046': { stats: { rec: 0 } } }), store },
    )
    expect(report.weeks).toEqual([{ week: 4, outcome: 'not_published', lines: 0 }])
    expect(store.confirmWeek).toHaveBeenCalledWith(expect.objectContaining({ week: 4, status: 'not_published', rowCount: 0, payloadHash: null }))
    expect(store.recordWeekError).not.toHaveBeenCalled()
    expect(store.replaceWeek).not.toHaveBeenCalled()
  })

  it('one failing week is recorded and isolated — the next week still lands', async () => {
    const getBoard = vi.fn(async (_s: string, w: number) => {
      if (w === 4) return null
      if (w === 5) throw new Error('boom')
      return board(w, { '4046': { pts: 9 } })
    })
    const report = await ingestFutureWeeks({ sport: 'NFL', season: '2026', anchorWeek: 3, deadlineAt: FAR() }, { getBoard, store })
    expect(report.weeks.map((w) => [w.week, w.outcome])).toEqual([
      [4, 'error'],
      [5, 'error'],
      [6, 'written'],
      [7, 'written'],
    ])
    expect(store.recordWeekError).toHaveBeenCalledTimes(2)
    expect(store.recordWeekError.mock.calls.map((c) => (c[0] as { week: number }).week)).toEqual([4, 5])
  })

  it('a prune failure does not stop the weeks', async () => {
    store.pruneThrough.mockRejectedValueOnce(new Error('prune down'))
    const report = await ingestFutureWeeks(
      { sport: 'NFL', season: '2026', anchorWeek: 3, horizon: 1, deadlineAt: FAR() },
      { getBoard: async (_s, w) => board(w, { '4046': { pts: 9 } }), store },
    )
    expect(report.pruneError).toBe('prune down')
    expect(report.weeks).toEqual([{ week: 4, outcome: 'written', lines: 1 }])
  })

  it('past the deadline, no week is started and every week says deferred', async () => {
    const getBoard = vi.fn(async (_s: string, w: number) => board(w, { '4046': { pts: 9 } }))
    const report = await ingestFutureWeeks({ sport: 'NFL', season: '2026', anchorWeek: 3, deadlineAt: Date.now() }, { getBoard, store })
    expect(getBoard).not.toHaveBeenCalled()
    expect(report.weeks.map((w) => w.outcome)).toEqual(['deferred', 'deferred', 'deferred', 'deferred'])
    expect(store.replaceWeek).not.toHaveBeenCalled()
  })

  it('a board fetch that outlives its budget is an error for that week', async () => {
    vi.useFakeTimers()
    try {
      const pending = ingestFutureWeeks(
        { sport: 'NFL', season: '2026', anchorWeek: 3, horizon: 1, deadlineAt: Date.now() + 5_000 },
        { getBoard: () => new Promise<WeekBoard | null>(() => {}), store },
      )
      await vi.advanceTimersByTimeAsync(6_000)
      const report = await pending
      expect(report.weeks[0]).toMatchObject({ week: 4, outcome: 'error' })
      expect(report.weeks[0]!.error).toMatch(/timed out/)
    } finally {
      vi.useRealTimers()
    }
  })
})
