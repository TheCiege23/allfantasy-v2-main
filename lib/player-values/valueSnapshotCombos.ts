/**
 * The distinct (format, qbFormat) combinations present in `PlayerValueSnapshot`.
 *
 * `findMany({ distinct: [...] })` on Prisma 5 without the `nativeDistinct` preview applies the
 * distinct IN MEMORY: the SQL it sends is `SELECT id, format, "qbFormat" … ORDER BY id OFFSET 0`,
 * so every row of the table (71k at 2026-10-24, 1.3 s per call) crossed the wire to produce about
 * four pairs. This asks Postgres for the pairs instead.
 *
 * ⚠ SAME ROWS, SAME ORDER. Prisma keeps the first row of each pair in `id` order and then applies
 * `take`, so the pairs come back ordered by the lowest `id` that carries them. `ORDER BY min(id)`
 * reproduces that exactly, including which pairs survive when there are more than `cap`.
 */
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { readOptimizationEnabled } from '@/lib/perf/readOptimizations'

export type ValueSnapshotCombo = { format: string; qbFormat: string }

export async function loadValueSnapshotCombos(
  cap: number,
  client: Pick<PrismaClient, '$queryRaw' | 'playerValueSnapshot'> = defaultPrisma,
): Promise<ValueSnapshotCombo[]> {
  if (!readOptimizationEnabled('value-combos')) {
    return client.playerValueSnapshot.findMany({
      select: { format: true, qbFormat: true },
      distinct: ['format', 'qbFormat'],
      take: cap,
    })
  }
  return client.$queryRaw<ValueSnapshotCombo[]>`
    SELECT format, "qbFormat"
      FROM "PlayerValueSnapshot"
     GROUP BY format, "qbFormat"
     ORDER BY min(id)
     LIMIT ${cap}`
}
