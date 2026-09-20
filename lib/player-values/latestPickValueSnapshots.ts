/**
 * The newest stored DRAFT-PICK rows for one value book.
 *
 * ── 🛑 WHY THIS IS NOT `loadLatestPlayerValueSnapshots` ────────────────────────────────────────
 *
 * That loader takes the ids it should return. It cannot serve picks, because a caller pricing
 * "2027 1st" does not know FantasyCalc's synthetic id for it (`FP_2027_early_0`) and has no way
 * to derive one — the name is the only join we have, and the name is what comes back.
 *
 * ── WHY IT IS NOT A `findMany` + DEDUPE EITHER ────────────────────────────────────────────────
 *
 * `ingestPlayerValues` APPENDS a dated row per asset per book daily and nothing deletes one, so
 * the obvious `orderBy: { capturedAt: 'desc' }` + "first row per id wins" returns
 * `picks × days-since-ingest-began` rows to keep one day of them, and the multiplier grows by one
 * every day forever. `latestPlayerValueSnapshots.ts` records that exact measurement for players —
 * 2,723 rows fetched to keep 250 — and picks would repeat it at roughly 78 rows a day per book.
 *
 * So: resolve the newest `capturedAt` for this book's picks, then read that capture only. Two
 * bounded probes, and the row count stays flat as history accumulates.
 *
 * ⚠ ONE BOOK PER CALL, AND `source` IS REQUIRED, for the licence reason `valueBook.ts` states:
 * DynastyProcess rows are FantasyPros ECR derivatives whose terms prohibit commercial use. Today
 * only FantasyCalc rows exist, which is exactly why the filter is written down rather than
 * omitted — the moment a second source lands an unfiltered read starts pricing on it silently.
 *
 * ⚠ PICKS ONLY EXIST HERE FROM 2026-09-20. Before that `ingestPlayerValues` discarded every pick
 * row FantasyCalc sends, so this returns [] against any capture older than that — which reads as
 * "unpriced", never as zero.
 */
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

/** Only what pricing a pick needs — `lib/core-app/tradePicks.ts` consumes this shape. */
export type LatestPickValueSnapshot = {
  name: string
  value: number
  overallRank: number | null
}

/** Only what this helper needs, so a caller or a test can hand in its own client. */
export type LatestPickValueClient = {
  $queryRaw: <T = unknown>(query: Prisma.Sql) => Promise<T>
}

export async function loadLatestPickValueSnapshots(args: {
  source: string
  format: string
  qbFormat: string
  client?: LatestPickValueClient
}): Promise<LatestPickValueSnapshot[]> {
  const db = args.client ?? (prisma as unknown as LatestPickValueClient)

  return db.$queryRaw<LatestPickValueSnapshot[]>(Prisma.sql`
    WITH newest AS (
      SELECT MAX(p."capturedAt") AS "capturedAt"
      FROM "PlayerValueSnapshot" p
      WHERE p."source" = ${args.source}
        AND p."format" = ${args.format}
        AND p."qbFormat" = ${args.qbFormat}
        AND p."position" = 'PICK'
    )
    SELECT p."name", p."value", p."overallRank"
    FROM "PlayerValueSnapshot" p
    JOIN newest n ON p."capturedAt" = n."capturedAt"
    WHERE p."source" = ${args.source}
      AND p."format" = ${args.format}
      AND p."qbFormat" = ${args.qbFormat}
      AND p."position" = 'PICK'
  `)
}
