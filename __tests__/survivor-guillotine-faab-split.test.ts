// @vitest-environment node
/**
 * Survivor Guilly FAAB split (lib/survivor-guillotine/faabSplit.ts): both balances move together, and a
 * chop reversed after a stat correction gives the money back.
 */
import { describe, expect, it } from 'vitest'
import { readSGFaabSplit, reverseSGFaabSplit, splitSGChoppedFaab } from '@/lib/survivor-guillotine/faabSplit'

type R = { id: string; faabRemaining: number | null; redraftRosterId: string | null }
function makeTx(rosters: R[]) {
  const roster = new Map(rosters.map((r) => [r.id, { ...r }]))
  const redraft = new Map(rosters.filter((r) => r.redraftRosterId).map((r) => [r.redraftRosterId!, { faabBalance: r.faabRemaining }]))
  const apply = (cur: number | null, data: { faabRemaining?: unknown; faabBalance?: unknown }, key: 'faabRemaining' | 'faabBalance') => {
    const v = data[key] as number | { increment?: number; decrement?: number } | undefined
    if (v === undefined) return cur
    if (typeof v === 'number') return v
    return (cur ?? 0) + (v.increment ?? 0) - (v.decrement ?? 0)
  }
  const tx = {
    roster: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => roster.has(id)).map((id) => ({ ...roster.get(id)! })),
      updateMany: async ({ where, data }: { where: { id: string; faabRemaining?: number }; data: { faabRemaining: unknown } }) => {
        const r = roster.get(where.id)
        if (!r || (where.faabRemaining !== undefined && r.faabRemaining !== where.faabRemaining)) return { count: 0 }
        r.faabRemaining = apply(r.faabRemaining, data, 'faabRemaining')
        return { count: 1 }
      },
      update: async ({ where, data }: { where: { id: string }; data: { faabRemaining: unknown } }) => {
        const r = roster.get(where.id)!
        r.faabRemaining = apply(r.faabRemaining, data, 'faabRemaining')
        return r
      },
    },
    redraftRoster: {
      updateMany: async ({ where, data }: { where: { id: string; faabBalance?: { gte: number } }; data: { faabBalance: unknown } }) => {
        const r = redraft.get(where.id)
        if (!r || (where.faabBalance && (r.faabBalance ?? 0) < where.faabBalance.gte)) return { count: 0 }
        r.faabBalance = apply(r.faabBalance, data, 'faabBalance')
        return { count: 1 }
      },
    },
  }
  return { tx: tx as never, roster, redraft }
}

const league = () => makeTx([
  { id: 'cut', faabRemaining: 61, redraftRosterId: 'rd-cut' },
  { id: 'a', faabRemaining: 40, redraftRosterId: 'rd-a' },
  { id: 'b', faabRemaining: 10, redraftRosterId: 'rd-b' },
  { id: 'c', faabRemaining: 0, redraftRosterId: 'rd-c' },
])
const both = (db: ReturnType<typeof makeTx>, id: string) => [db.roster.get(id)!.faabRemaining, db.redraft.get(`rd-${id}`)!.faabBalance]

describe('splitSGChoppedFaab', () => {
  it('moves the chopped team\'s FAAB to the survivors, in both balances', async () => {
    const db = league()
    const split = await splitSGChoppedFaab(db.tx, { choppedRosterIds: ['cut'], survivorRosterIds: ['a', 'b', 'c'] })
    // floor(61/3)=20 each, the extra dollar to the lowest balance (c).
    expect(split).toEqual({ pool: 61, taken: { cut: 61 }, shares: { a: 20, b: 20, c: 21 } })
    expect(both(db, 'cut')).toEqual([0, 0])
    expect(both(db, 'a')).toEqual([60, 60])
    expect(both(db, 'b')).toEqual([30, 30])
    expect(both(db, 'c')).toEqual([21, 21])
  })

  it('no survivor has a budget: the chopped team\'s money is left alone, never burned', async () => {
    const db = makeTx([{ id: 'cut', faabRemaining: 50, redraftRosterId: 'rd-cut' }, { id: 'a', faabRemaining: null, redraftRosterId: null }])
    expect(await splitSGChoppedFaab(db.tx, { choppedRosterIds: ['cut'], survivorRosterIds: ['a'] })).toBeNull()
    expect(both(db, 'cut')).toEqual([50, 50])
  })

  it('a chopped team with nothing left moves nothing', async () => {
    const db = makeTx([{ id: 'cut', faabRemaining: 0, redraftRosterId: null }, { id: 'a', faabRemaining: 5, redraftRosterId: null }])
    expect(await splitSGChoppedFaab(db.tx, { choppedRosterIds: ['cut'], survivorRosterIds: ['a'] })).toBeNull()
    expect(db.roster.get('a')!.faabRemaining).toBe(5)
  })
})

describe('reverseSGFaabSplit', () => {
  it('a reversed chop gives everything back when nobody spent their share', async () => {
    const db = league()
    const split = (await splitSGChoppedFaab(db.tx, { choppedRosterIds: ['cut'], survivorRosterIds: ['a', 'b', 'c'] }))!
    expect(await reverseSGFaabSplit(db.tx, readSGFaabSplit(JSON.parse(JSON.stringify(split)))!)).toEqual({ unrecovered: 0 })
    expect(both(db, 'cut')).toEqual([61, 61])
    expect(both(db, 'a')).toEqual([40, 40])
    expect(both(db, 'c')).toEqual([0, 0])
  })

  it('a survivor who already spent part of its share gives back what it has, never going below zero', async () => {
    const db = league()
    const split = (await splitSGChoppedFaab(db.tx, { choppedRosterIds: ['cut'], survivorRosterIds: ['a', 'b', 'c'] }))!
    // c won a waiver bid for 15 of its 21.
    db.roster.get('c')!.faabRemaining = 6
    db.redraft.get('rd-c')!.faabBalance = 6
    expect(await reverseSGFaabSplit(db.tx, split)).toEqual({ unrecovered: 15 })
    expect(both(db, 'c')).toEqual([0, 0])
    expect(both(db, 'cut')).toEqual([61, 61])
  })
})
