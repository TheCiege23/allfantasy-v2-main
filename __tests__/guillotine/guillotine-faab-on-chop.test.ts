/**
 * A chopped team's unspent FAAB (lib/guillotine/faabOnChop.ts + faabOnChopApply.ts). With "split",
 * the chop hands it evenly to the teams still alive; every dollar is handed out, a retry moves
 * nothing twice, and a league without FAAB is left untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; faabRemaining: number | null }
const rows = new Map<string, Row>()
const tx = {
  roster: {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.flatMap((id) => (rows.has(id) ? [{ ...rows.get(id)! }] : []))),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; faabRemaining?: number }; data: { faabRemaining: number } }) => {
      const row = rows.get(where.id)
      if (!row || (where.faabRemaining !== undefined && row.faabRemaining !== where.faabRemaining)) return { count: 0 }
      row.faabRemaining = data.faabRemaining
      return { count: 1 }
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { faabRemaining: { increment: number } } }) => {
      const row = rows.get(where.id)!
      row.faabRemaining = (row.faabRemaining ?? 0) + data.faabRemaining.increment
      return row
    }),
  },
}
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } }))

import { readFaabOnChop, splitChoppedFaab } from '@/lib/guillotine/faabOnChop'
import { redistributeChoppedFaab } from '@/lib/guillotine/faabOnChopApply'

function seed(list: Row[]) {
  rows.clear()
  for (const r of list) rows.set(r.id, { ...r })
}
const total = () => [...rows.values()].reduce((sum, r) => sum + (r.faabRemaining ?? 0), 0)

beforeEach(() => vi.clearAllMocks())

describe('splitChoppedFaab', () => {
  it('hands out every dollar; leftover dollars go to the teams with the least FAAB', () => {
    const { pool, shares } = splitChoppedFaab(65, [
      { rosterId: 'a', faab: 40 },
      { rosterId: 'b', faab: 5 },
      { rosterId: 'c', faab: 90 },
    ])
    expect(pool).toBe(65)
    expect([...shares.values()].reduce((x, y) => x + y, 0)).toBe(65)
    expect(shares.get('b')).toBe(22) // 21 each, the neediest team gets the spare 2nd dollar…
    expect(shares.get('a')).toBe(22) // …and the next neediest the other
    expect(shares.get('c')).toBe(21)
  })

  it('moves nothing when there is nothing to move or nobody to give it to', () => {
    expect(splitChoppedFaab(0, [{ rosterId: 'a', faab: 1 }]).pool).toBe(0)
    expect(splitChoppedFaab(50, []).pool).toBe(0)
  })

  it('reads the setting, defaulting to keep', () => {
    expect(readFaabOnChop({ guillotineFaabOnChop: 'split' })).toBe('split')
    expect(readFaabOnChop({})).toBe('keep')
    expect(readFaabOnChop(null)).toBe('keep')
  })
})

describe('redistributeChoppedFaab', () => {
  it("splits the chopped team's balance across the survivors and zeroes it", async () => {
    seed([
      { id: 'chopped', faabRemaining: 60 },
      { id: 's1', faabRemaining: 10 },
      { id: 's2', faabRemaining: 30 },
      { id: 's3', faabRemaining: 0 },
    ])
    const before = total()
    const r = await redistributeChoppedFaab({ choppedRosterIds: ['chopped'], survivorRosterIds: ['s1', 's2', 's3'] })
    expect(r).toMatchObject({ pool: 60, perTeam: 20, survivors: 3 })
    expect(rows.get('chopped')!.faabRemaining).toBe(0)
    expect([rows.get('s1')!.faabRemaining, rows.get('s2')!.faabRemaining, rows.get('s3')!.faabRemaining]).toEqual([30, 50, 20])
    expect(total()).toBe(before) // no money made or lost
  })

  it('a retried chop moves nothing a second time', async () => {
    seed([
      { id: 'chopped', faabRemaining: 60 },
      { id: 's1', faabRemaining: 10 },
      { id: 's2', faabRemaining: 30 },
    ])
    await redistributeChoppedFaab({ choppedRosterIds: ['chopped'], survivorRosterIds: ['s1', 's2'] })
    const after = [...rows.values()].map((r) => r.faabRemaining)
    expect(await redistributeChoppedFaab({ choppedRosterIds: ['chopped'], survivorRosterIds: ['s1', 's2'] })).toBeNull()
    expect([...rows.values()].map((r) => r.faabRemaining)).toEqual(after)
  })

  it('a balance spent between the read and the write is not paid out', async () => {
    seed([
      { id: 'chopped', faabRemaining: 60 },
      { id: 's1', faabRemaining: 10 },
    ])
    tx.roster.findMany.mockImplementationOnce(async () => [
      { id: 'chopped', faabRemaining: 75 }, // stale read: the real row holds 60
      { id: 's1', faabRemaining: 10 },
    ])
    expect(await redistributeChoppedFaab({ choppedRosterIds: ['chopped'], survivorRosterIds: ['s1'] })).toBeNull()
    expect(rows.get('chopped')!.faabRemaining).toBe(60)
    expect(rows.get('s1')!.faabRemaining).toBe(10)
  })

  it('leaves a league without FAAB alone', async () => {
    seed([
      { id: 'chopped', faabRemaining: 40 },
      { id: 's1', faabRemaining: null },
      { id: 's2', faabRemaining: null },
    ])
    expect(await redistributeChoppedFaab({ choppedRosterIds: ['chopped'], survivorRosterIds: ['s1', 's2'] })).toBeNull()
    expect(rows.get('chopped')!.faabRemaining).toBe(40)
    expect(tx.roster.updateMany).not.toHaveBeenCalled()
  })
})
