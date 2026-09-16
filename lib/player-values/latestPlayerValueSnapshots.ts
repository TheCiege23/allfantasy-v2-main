/**
 * The newest `PlayerValueSnapshot` per player, in one indexed query.
 *
 * ── 🛑 WHY THIS EXISTS: EVERY READER FETCHED THE WHOLE HISTORY TO KEEP ONE ROW ─────────────────
 *
 * `ingestPlayerValues` (from `/api/cron/adp-refresh`, daily) APPENDS a dated row per player per
 * book; nothing ever deletes one. The readers all wanted only the newest, and all got it the same
 * way: `findMany({ where: { sleeperId: { in } }, orderBy: { capturedAt: 'desc' } })`, then "first
 * row per id wins" in JavaScript. So every read returned `players × days-since-ingest-began` rows
 * and threw all but one per player away — and the multiplier grows by one every day, forever.
 *
 * Measured on staging (`ep-muddy-leaf`, 2026-09-16, 13 days of history there) for 250 dynasty
 * superflex players: **2,723 rows fetched to keep 250**. Production has ingested daily since
 * 2026-08-17 and does not stop. `rosterGrade` read that way for EVERY rostered player in a league.
 *
 * ── THE QUERY ─────────────────────────────────────────────────────────────────────────────────
 *
 * One `LATERAL … ORDER BY "capturedAt" DESC LIMIT 1` per id. The table's unique constraint is
 * `(sleeperId, source, format, qbFormat, capturedAt)`, which is exactly an equality prefix plus
 * the sort key, so each lookup is a single backward index probe. Staging EXPLAIN: `Index Scan
 * Backward using "PlayerValueSnapshot_uniq"`, 1.1 ms for 251 ids, 752 buffer hits.
 *
 * ⚠ SAME ANSWER, NOT A NEAR ONE. Compared on those 250 players against the old read's first row
 * per id: 0 mismatches in value and in `capturedAt`. The unique constraint includes `capturedAt`,
 * so two rows can never tie for "newest" within a book — there is no tie-break to disagree about.
 *
 * ⚠ `DISTINCT ON` or Prisma's `distinct` is NOT the same fix. Prisma 5 without the `nativeDistinct`
 * preview deduplicates IN MEMORY after fetching every row, and a `DISTINCT ON` still reads every
 * matching row server-side before discarding. Only the LATERAL form stops at one row per id.
 *
 * ⚠ ONE BOOK PER CALL, and `source` is REQUIRED. `source: 'FANTASYCALC'` is a licence boundary
 * (see `lib/core-app/valueBook.ts`), so a caller may not omit it and get every source by accident.
 */
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export type LatestPlayerValueSnapshot = {
  sleeperId: string
  name: string
  position: string | null
  source: string
  format: string
  qbFormat: string
  value: number
  overallRank: number | null
  positionRank: number | null
  trend30d: number | null
  tradeFrequency: number | null
  marketStdDev: number | null
  capturedAt: Date
}

/** Only what this helper needs, so a caller or a test can hand in its own client. */
export type LatestPlayerValueClient = {
  $queryRaw: <T = unknown>(query: Prisma.Sql) => Promise<T>
}

/**
 * At most one row per requested id — the newest in the given book. An id with no row in that book
 * is simply absent: "unpriced", never a zero. Row ORDER is unspecified; key the result by id.
 */
export async function loadLatestPlayerValueSnapshots(args: {
  sleeperIds: Iterable<string>
  source: string
  format: string
  qbFormat: string
  client?: LatestPlayerValueClient
}): Promise<LatestPlayerValueSnapshot[]> {
  const ids = [...new Set([...args.sleeperIds].filter((id) => typeof id === 'string' && id.length > 0))]
  if (ids.length === 0) return []
  const db = args.client ?? (prisma as unknown as LatestPlayerValueClient)

  return db.$queryRaw<LatestPlayerValueSnapshot[]>(Prisma.sql`
    SELECT v.*
    FROM unnest(${ids}::text[]) AS ids(sid)
    CROSS JOIN LATERAL (
      SELECT
        p."sleeperId", p."name", p."position", p."source", p."format", p."qbFormat",
        p."value", p."overallRank", p."positionRank", p."trend30d",
        p."tradeFrequency", p."marketStdDev", p."capturedAt"
      FROM "PlayerValueSnapshot" p
      WHERE p."sleeperId" = ids.sid
        AND p."source" = ${args.source}
        AND p."format" = ${args.format}
        AND p."qbFormat" = ${args.qbFormat}
      ORDER BY p."capturedAt" DESC
      LIMIT 1
    ) v
  `)
}
