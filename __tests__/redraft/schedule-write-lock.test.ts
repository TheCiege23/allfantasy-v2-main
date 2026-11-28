/**
 * lib/redraft/scheduleWriteLock.ts — two draft syncs racing used to write a season's schedule twice
 * (2026-11-28: one NBA league's scoreboard listed the same game three times). The insert now re-checks
 * under a per-season advisory lock; these tests pin that the re-check decides, and that the lock is taken.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => {
  const rows: unknown[] = []
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    redraftMatchup: {
      count: vi.fn(async () => rows.length),
      createMany: vi.fn(async (args: { data: unknown[] }) => { rows.push(...args.data); return { count: args.data.length } }),
    },
  }
  // Serialise like the advisory lock does: each transaction runs after the previous one settles.
  let chain: Promise<unknown> = Promise.resolve()
  const $transaction = vi.fn((fn: (t: typeof tx) => Promise<unknown>) => {
    const run = chain.then(() => fn(tx))
    chain = run.catch(() => undefined)
    return run
  })
  return { rows, tx, $transaction }
})
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: db.$transaction } }))

import { createScheduleRowsOnce } from '@/lib/redraft/scheduleWriteLock'

const row = { seasonId: 'S', leagueId: 'L', week: 1, type: 'regular', homeRosterId: 'a', awayRosterId: 'b', isMedianMatchup: false }
const write = () =>
  createScheduleRowsOnce({
    seasonId: 'S',
    alreadyWritten: async (tx) => (await tx.redraftMatchup.count({ where: { seasonId: 'S' } })) > 0,
    rows: [row, { ...row, homeRosterId: 'c', awayRosterId: 'd' }],
  })

beforeEach(() => {
  db.rows.length = 0
  vi.clearAllMocks()
})

describe('createScheduleRowsOnce', () => {
  it('three runs racing write the schedule once', async () => {
    const results = await Promise.all([write(), write(), write()])
    expect(db.rows).toHaveLength(2)
    expect(results.map((r) => r.created).sort()).toEqual([0, 0, 2])
  })

  it('takes the per-season lock before checking', async () => {
    await write()
    expect(db.tx.$executeRaw).toHaveBeenCalledTimes(1)
    const sql = (db.tx.$executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]])
    expect(sql[0].join('?')).toContain('pg_advisory_xact_lock')
    expect(sql[1]).toBe('redraft-schedule:S')
  })

  it('[control] without the re-check every run writes, which is the bug', async () => {
    const naive = () => createScheduleRowsOnce({ seasonId: 'S', alreadyWritten: async () => false, rows: [row] })
    await Promise.all([naive(), naive(), naive()])
    expect(db.rows).toHaveLength(3)
  })

  it('writes nothing for an empty schedule and opens no transaction', async () => {
    expect(await createScheduleRowsOnce({ seasonId: 'S', alreadyWritten: async () => false, rows: [] })).toEqual({ created: 0 })
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})
