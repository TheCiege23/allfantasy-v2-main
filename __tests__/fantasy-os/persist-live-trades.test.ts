import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the LIVE trade writer added 2026-09-05.
 *
 * `persistTradesForSeason` is mocked: it is the historical importer's writer, already exercised by
 * that path, and its behaviour is a Prisma upsert. What is NEW and therefore worth pinning is
 * everything ABOVE it — the filtering and the shape conversion — because that is where a live feed
 * differs from a finalized-season import.
 *
 * 🛑 THE FILTER IS THE PART THAT MATTERS MOST. Sleeper serves proposed and vetoed trades from the
 * same endpoint as completed ones. The historical importer filters on `type === 'trade'` alone and
 * is right to: a finished season contains no in-flight proposals. A live sync sees them, and
 * writing one would put a trade that never happened into the table the trade grader reads.
 */
/*
 * ⚠ THE MOCK DECLARES THE REAL SIGNATURE ON PURPOSE. `vi.fn(async () => 0)` infers a ZERO-ARGUMENT
 * call signature, so `mock.calls[0]` types as an empty tuple and every `calls[0][2]` below is a
 * type error — 8 of them. Nothing surfaced it, because tsconfig excludes `__tests__` and this repo
 * never typechecks a test file. Pinning the four parameters keeps the argument assertions honest:
 * reorder `persistTradesForSeason` and these reads stop compiling instead of silently reading the
 * wrong index.
 */
const persistTradesForSeasonMock = vi.hoisted(() =>
  vi.fn(
    async (
      _platformLeagueId: string,
      _season: number,
      _trades: unknown[],
      _rosterIdToOwner: Map<string, string>,
    ): Promise<number> => 0,
  ),
)
vi.mock('@/lib/dynasty-import/normalize-historical', () => ({
  persistTradesForSeason: persistTradesForSeasonMock,
}))

import { persistLiveTrades } from '@/lib/import-os/collector/persistLiveTrades'
import type { NormalizedImportResult, NormalizedTransaction } from '@/lib/league-import/types'

function tx(over: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    source_transaction_id: 'tx1',
    type: 'trade',
    status: 'complete',
    created_at: '2026-09-05T04:00:00.000Z',
    adds: { '4034': '2' },
    drops: { '4034': '1' },
    roster_ids: ['1', '2'],
    week: 1,
    ...over,
  }
}

function normalized(transactions: NormalizedTransaction[]): NormalizedImportResult {
  return {
    source: { source_provider: 'sleeper', source_league_id: 'L1', imported_at: '2026-09-05T00:00:00Z' },
    league: { name: 'Test', season: 2026 },
    rosters: [
      { source_team_id: '1', source_manager_id: 'ownerA' },
      { source_team_id: '2', source_manager_id: 'ownerB' },
    ],
    transactions,
  } as unknown as NormalizedImportResult
}

async function run(transactions: NormalizedTransaction[]) {
  return persistLiveTrades({ platformLeagueId: 'L1', season: 2026, normalized: normalized(transactions) })
}

beforeEach(() => {
  persistTradesForSeasonMock.mockClear()
  persistTradesForSeasonMock.mockResolvedValue(2)
})

describe('persistLiveTrades', () => {
  it('writes a completed trade', async () => {
    const r = await run([tx()])
    expect(r.tradesSeen).toBe(1)
    expect(r.rowsWritten).toBe(2)
    expect(persistTradesForSeasonMock).toHaveBeenCalledTimes(1)
  })

  it('IGNORES proposed and vetoed trades — they never happened', async () => {
    const r = await run([
      tx({ source_transaction_id: 'p', status: 'proposed' }),
      tx({ source_transaction_id: 'v', status: 'vetoed' }),
    ])
    expect(r.tradesSeen).toBe(0)
    expect(r.rowsWritten).toBe(0)
    // Not merely "wrote nothing" — it must not reach the writer at all.
    expect(persistTradesForSeasonMock).not.toHaveBeenCalled()
  })

  it('ignores waivers and free-agent adds', async () => {
    const r = await run([tx({ type: 'waiver' }), tx({ type: 'free_agent' })])
    expect(r.tradesSeen).toBe(0)
    expect(persistTradesForSeasonMock).not.toHaveBeenCalled()
  })

  it('carries the week through, since LeagueTrade.week is written from it', async () => {
    await run([tx({ week: 3 })])
    const facts = persistTradesForSeasonMock.mock.calls[0][2] as Array<{ week: number }>
    expect(facts[0].week).toBe(3)
  })

  it('defaults an absent week to 0 rather than writing NaN', async () => {
    await run([tx({ week: undefined })])
    const facts = persistTradesForSeasonMock.mock.calls[0][2] as Array<{ week: number }>
    expect(facts[0].week).toBe(0)
  })

  it('converts roster ids and add/drop maps to numbers', async () => {
    await run([tx()])
    const facts = persistTradesForSeasonMock.mock.calls[0][2] as Array<{
      rosterIds: number[]
      adds: Record<string, number> | null
      drops: Record<string, number> | null
    }>
    expect(facts[0].rosterIds).toEqual([1, 2])
    expect(facts[0].adds).toEqual({ '4034': 2 })
    expect(facts[0].drops).toEqual({ '4034': 1 })
  })

  it('builds the roster→owner map the writer needs from the same payload', async () => {
    await run([tx()])
    const map = persistTradesForSeasonMock.mock.calls[0][3] as Map<string, string>
    expect(map.get('1')).toBe('ownerA')
    expect(map.get('2')).toBe('ownerB')
  })

  it('reports a trade whose rosters match no known owner instead of silently dropping it', async () => {
    const r = await run([tx({ roster_ids: ['98', '99'] })])
    expect(r.tradesSeen).toBe(1)
    expect(r.skippedNoOwner).toBe(1)
  })

  it('does no work and calls nothing when there are no transactions', async () => {
    const r = await run([])
    expect(r).toEqual({ tradesSeen: 0, rowsWritten: 0, skippedNoOwner: 0 })
    expect(persistTradesForSeasonMock).not.toHaveBeenCalled()
  })
})
