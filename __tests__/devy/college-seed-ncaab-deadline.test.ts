/**
 * `seedCollegePlayers({ sport: 'NCAAB' })` can now be bounded by a deadline and resumed from an
 * offset, so the scheduled writer on the `?intel=1` tick cannot run its upsert loop into the 300s
 * edge. The deadline is checked BETWEEN batches of 100 (a batch is one transaction and is never
 * cut). Called with neither option it behaves as before: every row, one pass.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  transactions: 0,
  upsertNames: [] as string[],
  onTransaction: null as null | (() => void),
}))

vi.mock('@/lib/workers/api-chain', () => ({
  apiChain: { fetch: vi.fn(async () => ({ data: h.rows, source: 'rolling_insights' })) },
}))
vi.mock('@/lib/devy-classification', () => ({ ingestCFBDRosters: vi.fn(), ingestCFBDStats: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    devyPlayer: {
      upsert: vi.fn((args: { create: { name: string } }) => {
        h.upsertNames.push(args.create.name)
        return args
      }),
      count: vi.fn(async () => 999),
    },
    $transaction: vi.fn(async (ops: unknown[]) => {
      h.transactions += 1
      h.onTransaction?.()
      return ops
    }),
  },
}))

import { seedCollegePlayers } from '@/lib/devy/CollegePlayerSeedService'

const makeRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Player ${i}`, position: 'G', team: 'Duke' }))

beforeEach(() => {
  h.rows = makeRows(250)
  h.transactions = 0
  h.upsertNames.length = 0
  h.onTransaction = null
})

describe('NCAAB seed bounds', () => {
  it('with no options, writes every row and reports completion', async () => {
    const r = await seedCollegePlayers({ sport: 'NCAAB' })

    expect(h.transactions).toBe(3)
    expect(r.seeded).toBe(250)
    expect(r.fetched).toBe(250)
    expect(r.nextOffset).toBeNull()
  })

  it('stops between batches once the deadline passes, and says where to resume', async () => {
    let now = 1_000_000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    // The first batch spends the whole allowance.
    h.onTransaction = () => {
      now += 60_000
    }

    const r = await seedCollegePlayers({ sport: 'NCAAB', deadlineAt: 1_000_000 + 30_000 })
    spy.mockRestore()

    expect(h.transactions).toBe(1)
    expect(r.seeded).toBe(100)
    expect(r.nextOffset).toBe(100)
  })

  it('resumes from an offset', async () => {
    const r = await seedCollegePlayers({ sport: 'NCAAB', startAt: 200 })

    expect(h.transactions).toBe(1)
    expect(h.upsertNames[0]).toBe('Player 200')
    expect(r.seeded).toBe(50)
    expect(r.nextOffset).toBeNull()
  })
})
