/**
 * The Fleaflicker/MFL → Sleeper id bridge, filled from the cached FantasyCalc values.
 *
 * Planner rules (pure) and the writer's contract: DB-only, never overwrites, only onto rows that
 * already carry the Sleeper id, and each write re-asserts the column is still empty.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { planIdentityBridge } from '@/lib/player-identity/identityBridgePlan'
import { bridgeIdentityMapFromFantasyCalcCache } from '@/lib/player-identity/fantasyCalcIdentityBridge'

describe('planIdentityBridge', () => {
  it('writes a one-to-one pair onto the row that holds the Sleeper id', () => {
    const { writes, stats } = planIdentityBridge(
      [{ sleeperId: '4034', fleaflickerId: '9001', mflId: '13604' }],
      [{ sleeperId: '4034', fleaflickerId: null, mflId: null }],
    )
    expect(writes).toEqual([
      { sleeperId: '4034', column: 'fleaflickerId', value: '9001' },
      { sleeperId: '4034', column: 'mflId', value: '13604' },
    ])
    expect(stats.fleaflickerId).toMatchObject({ candidates: 1, writes: 1 })
  })

  it('drops a provider id tied to two Sleeper ids, and a Sleeper id tied to two provider ids', () => {
    const { writes, stats } = planIdentityBridge(
      [
        { sleeperId: 'a', fleaflickerId: 'X' },
        { sleeperId: 'b', fleaflickerId: 'X' },
        { sleeperId: 'c', fleaflickerId: 'Y' },
        { sleeperId: 'c', fleaflickerId: 'Z' },
      ],
      ['a', 'b', 'c'].map((sleeperId) => ({ sleeperId, fleaflickerId: null })),
    )
    expect(writes).toEqual([])
    expect(stats.fleaflickerId.ambiguous).toBe(3)
  })

  it('the same pair stated twice is one fact, not a conflict', () => {
    const { writes } = planIdentityBridge(
      [{ sleeperId: 'a', fleaflickerId: 'X' }, { sleeperId: 'a', fleaflickerId: 'X' }],
      [{ sleeperId: 'a', fleaflickerId: null }],
    )
    expect(writes).toEqual([{ sleeperId: 'a', column: 'fleaflickerId', value: 'X' }])
  })

  it('never overwrites: a different stored value, or the id already on another row, is a conflict', () => {
    const { writes, stats } = planIdentityBridge(
      [{ sleeperId: 'a', fleaflickerId: 'X' }, { sleeperId: 'b', fleaflickerId: 'Y' }],
      [
        { sleeperId: 'a', fleaflickerId: 'OTHER' },
        { sleeperId: 'b', fleaflickerId: null },
        { sleeperId: 'z', fleaflickerId: 'Y' },
      ],
    )
    expect(writes).toEqual([])
    expect(stats.fleaflickerId).toMatchObject({ conflicts: 2 })
  })

  it('counts already-set and rows that do not exist, and writes neither', () => {
    const { writes, stats } = planIdentityBridge(
      [{ sleeperId: 'a', fleaflickerId: 'X' }, { sleeperId: 'nobody', fleaflickerId: 'Q' }],
      [{ sleeperId: 'a', fleaflickerId: 'X' }],
    )
    expect(writes).toEqual([])
    expect(stats.fleaflickerId).toMatchObject({ alreadySet: 1, noRow: 1 })
  })
})

describe('bridgeIdentityMapFromFantasyCalcCache', () => {
  function fakeDb() {
    const updates: Array<Record<string, any>> = []
    return {
      updates,
      db: {
        playerIdentityMap: {
          findMany: vi.fn(async () => [
            { sleeperId: '4034', fleaflickerId: null, mflId: null },
            { sleeperId: '6794', fleaflickerId: null, mflId: null },
          ]),
          updateMany: vi.fn(async (args: Record<string, any>) => {
            updates.push(args)
            return { count: 1 }
          }),
        },
      } as any,
    }
  }
  const sources = async () =>
    [
      { sleeperId: '4034', fleaflickerId: '9001', mflId: '13604' },
      { sleeperId: '6794', fleaflickerId: '9002', mflId: '14000' },
    ] as any

  it('writes only into an EMPTY column, re-asserted at write time', async () => {
    const { db, updates } = fakeDb()
    const res = await bridgeIdentityMapFromFantasyCalcCache({ prisma: db, readSources: sources })
    expect(res.written).toBe(4)
    expect(updates[0]).toEqual({ where: { sleeperId: '4034', fleaflickerId: null }, data: { fleaflickerId: '9001' } })
    expect(updates.every((u) => Object.values(u.where).includes(null))).toBe(true)
  })

  it('a dry run writes nothing', async () => {
    const { db, updates } = fakeDb()
    await bridgeIdentityMapFromFantasyCalcCache({ prisma: db, readSources: sources, dryRun: true })
    expect(updates).toEqual([])
  })

  it('stops when the run budget is spent and reports what it deferred', async () => {
    const { db, updates } = fakeDb()
    let calls = 0
    const res = await bridgeIdentityMapFromFantasyCalcCache({ prisma: db, readSources: sources, isExhausted: () => ++calls > 1 })
    expect(updates).toHaveLength(1)
    expect(res.deferred).toBe(3)
  })
})
