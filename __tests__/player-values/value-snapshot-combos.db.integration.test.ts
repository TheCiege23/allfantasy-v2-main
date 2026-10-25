/**
 * `loadValueSnapshotCombos` against REAL Postgres and the REAL Prisma client: the database-level
 * DISTINCT returns exactly what Prisma's in-memory `distinct` returned, rows and order, including
 * which pairs survive the cap. A mock cannot prove that, because the claim is about what two
 * different SQL statements return.
 *
 * 🛑 OPT-IN AND LOCAL-ONLY, FAIL-CLOSED. Runs only when `AF_READ_OPT_DB_IT=1`, and refuses —
 * throws, never skips — unless DATABASE_URL points at localhost/127.0.0.1. It creates and deletes
 * its own rows (ids prefixed `zz-it-combo-`). Prepare a throwaway database with the repo's schema:
 *
 *   AF_READ_OPT_DB_IT=1 DATABASE_URL=postgresql://…@127.0.0.1:5432/<scratch> DIRECT_URL=$DATABASE_URL \
 *     node node_modules/vitest/vitest.mjs run __tests__/player-values/value-snapshot-combos.db.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const OPTED_IN = process.env.AF_READ_OPT_DB_IT === '1'
const PREFIX = 'zz-it-combo-'

function assertLocalDatabase(url: string | undefined) {
  if (!url) throw new Error('[value-combos DB IT] REFUSED: DATABASE_URL is not set')
  const host = new URL(url).hostname
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`[value-combos DB IT] REFUSED: DATABASE_URL host "${host}" is not local`)
  }
}

describe.skipIf(!OPTED_IN)('loadValueSnapshotCombos vs Prisma distinct (real Postgres)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let load: any

  beforeAll(async () => {
    assertLocalDatabase(process.env.DATABASE_URL)
    const { PrismaClient } = await import('@prisma/client')
    prisma = new PrismaClient()
    load = (await import('@/lib/player-values/valueSnapshotCombos')).loadValueSnapshotCombos
    await prisma.playerValueSnapshot.deleteMany({ where: { id: { startsWith: PREFIX } } })
    // The table must hold only this test's rows, or the comparison would include strangers.
    expect(await prisma.playerValueSnapshot.count()).toBe(0)
    /*
     * Pairs first appear in an order that is NOT alphabetical, and each pair recurs later, so a
     * query that sorted by value, or kept the last occurrence, would disagree with Prisma.
     */
    const pairs: Array<[string, string]> = [
      ['REDRAFT', 'SUPERFLEX'], ['DYNASTY', 'ONE_QB'], ['REDRAFT', 'ONE_QB'], ['DYNASTY', 'SUPERFLEX'],
    ]
    const rows = []
    for (let i = 0; i < 40; i++) {
      const [format, qbFormat] = pairs[i % 4 === 0 ? 0 : i < 4 ? i : (i * 7) % 4]!
      rows.push({
        id: `${PREFIX}${String(i).padStart(3, '0')}`,
        sleeperId: String(1000 + i), name: `P${i}`, source: 'FANTASYCALC', format, qbFormat, value: i,
        capturedAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
      })
    }
    await prisma.playerValueSnapshot.createMany({ data: rows })
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.playerValueSnapshot.deleteMany({ where: { id: { startsWith: PREFIX } } })
    await prisma.$disconnect()
  })

  for (const cap of [24, 4, 3, 2, 1]) {
    it(`same pairs in the same order with take=${cap}`, async () => {
      const legacy = await prisma.playerValueSnapshot.findMany({
        select: { format: true, qbFormat: true }, distinct: ['format', 'qbFormat'], take: cap,
      })
      const fast = await load(cap, prisma)
      expect(fast).toEqual(legacy)
      expect(fast.length).toBe(Math.min(cap, 4))
    })
  }

  it('the kill switch returns the Prisma result itself', async () => {
    process.env.AF_READ_OPTIMIZATIONS_OFF = 'value-combos'
    try {
      expect(await load(24, prisma)).toEqual(await prisma.playerValueSnapshot.findMany({
        select: { format: true, qbFormat: true }, distinct: ['format', 'qbFormat'], take: 24,
      }))
    } finally {
      delete process.env.AF_READ_OPTIMIZATIONS_OFF
    }
  })
})
