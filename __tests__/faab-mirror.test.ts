/**
 * A native league's two FAAB stores stay equal (lib/league/faabMirror.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const store = vi.hoisted(() => ({
  generic: [] as Array<{ id: string; faabRemaining: number | null; redraftRosterId: string | null }>,
  redraft: [] as Array<{ id: string; faabBalance: number | null }>,
}))

const db = vi.hoisted(() => ({
  roster: {
    findMany: vi.fn(async (args: { where: { id?: { in: string[] }; redraftRosterId?: { in: string[] } } }) =>
      store.generic.filter((r) => (args.where.id ? args.where.id.in.includes(r.id) : args.where.redraftRosterId!.in.includes(r.redraftRosterId ?? '')))),
    updateMany: vi.fn(async (args: { where: { id?: string; redraftRosterId?: string; faabRemaining?: number }; data: { faabRemaining: number } }) => {
      const rows = store.generic.filter((r) => (args.where.id ? r.id === args.where.id : r.redraftRosterId === args.where.redraftRosterId))
        .filter((r) => !('faabRemaining' in args.where) || r.faabRemaining === args.where.faabRemaining)
      for (const r of rows) r.faabRemaining = args.data.faabRemaining
      return { count: rows.length }
    }),
    update: vi.fn(async (args: { where: { id: string }; data: { faabRemaining: { increment: number } } }) => {
      const r = store.generic.find((x) => x.id === args.where.id)!
      r.faabRemaining = (r.faabRemaining ?? 0) + args.data.faabRemaining.increment
      return r
    }),
  },
  redraftRoster: {
    findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => store.redraft.filter((r) => args.where.id.in.includes(r.id))),
    updateMany: vi.fn(async (args: { where: { id: string }; data: { faabBalance: number } }) => {
      const r = store.redraft.find((x) => x.id === args.where.id)
      if (r) r.faabBalance = args.data.faabBalance
      return { count: r ? 1 : 0 }
    }),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { copyGenericFaabToRedraft, copyRedraftFaabToGeneric } from '@/lib/league/faabMirror'
import { redistributeChoppedFaab } from '@/lib/guillotine/faabOnChopApply'

const balances = () => ({
  generic: Object.fromEntries(store.generic.map((r) => [r.id, r.faabRemaining])),
  redraft: Object.fromEntries(store.redraft.map((r) => [r.id, r.faabBalance])),
})

beforeEach(() => {
  vi.clearAllMocks()
  store.generic = [
    { id: 'g1', faabRemaining: 70, redraftRosterId: 'r1' },
    { id: 'g2', faabRemaining: 100, redraftRosterId: 'r2' },
    { id: 'g3', faabRemaining: 40, redraftRosterId: 'r3' },
    { id: 'g4', faabRemaining: null, redraftRosterId: 'r4' },
  ]
  store.redraft = [
    { id: 'r1', faabBalance: 100 },
    { id: 'r2', faabBalance: 100 },
    { id: 'r3', faabBalance: 40 },
    { id: 'r4', faabBalance: 100 },
  ]
})

describe('copying FAAB between the two stores', () => {
  it('a native waiver spend reaches faabBalance (the standings and Chimmy read it)', async () => {
    await copyGenericFaabToRedraft(db as never, ['g1'])
    expect(balances().redraft.r1).toBe(70)
    expect(balances().redraft.r2).toBe(100)
  })

  it('a redraft-side change reaches faabRemaining (the waiver engine bids with it)', async () => {
    store.redraft[1].faabBalance = 85
    await copyRedraftFaabToGeneric(db as never, ['r2'])
    expect(balances().generic.g2).toBe(85)
  })

  it('never copies a null: FAAB off on one side does not wipe a real balance on the other', async () => {
    await copyGenericFaabToRedraft(db as never, ['g4'])
    expect(balances().redraft.r4).toBe(100)
  })

  it('a roster with no link is left alone', async () => {
    store.generic.push({ id: 'g5', faabRemaining: 10, redraftRosterId: null })
    await copyGenericFaabToRedraft(db as never, ['g5'])
    expect(db.redraftRoster.updateMany).not.toHaveBeenCalled()
  })
})

describe('plain Guilly chop with "split"', () => {
  it('moves the chopped team\'s FAAB in both stores', async () => {
    await redistributeChoppedFaab({ choppedRosterIds: ['g3'], survivorRosterIds: ['g1', 'g2'] })
    const b = balances()
    expect(b.generic.g3).toBe(0)
    expect((b.generic.g1 ?? 0) + (b.generic.g2 ?? 0)).toBe(210)
    expect(b.redraft).toMatchObject({ r1: b.generic.g1, r2: b.generic.g2, r3: 0 })
  })
})
