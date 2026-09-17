/**
 * `PlayerValueSnapshot` over a window — for the portfolio's value-movement chart.
 *
 * The table is append-only: `ingestPlayerValues` (from `/api/cron/adp-refresh`, daily) writes one
 * row per player per book per capture day, with `capturedAt` truncated to UTC midnight. So a "day"
 * here is a capture day, and the series has a gap wherever the cron did not run — which is shown
 * as a gap, never interpolated.
 *
 * ── 🛑 AGGREGATE IN SQL, NOT IN JS ─────────────────────────────────────────────────────────────
 *
 * A sixty-league portfolio holds ~1,200 (league, player) pairs. Pulling every priced row for a
 * 30-day window and summing in JavaScript is ~36,000 rows per book to produce ~1,800 totals. The
 * pairs go in as two parallel arrays and come back as one row per league per day.
 *
 * ⚠ ONE BOOK PER CALL, `source` REQUIRED — the same licence boundary as
 * `latestPlayerValueSnapshots.ts`. Summing across books would add a dynasty price to a redraft one.
 */
import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export type ValueBookRef = { source: string; format: string; qbFormat: string }

type RawClient = { $queryRaw: <T = unknown>(query: Prisma.Sql) => Promise<T> }

function client(c?: RawClient): RawClient {
  return c ?? (prisma as unknown as RawClient)
}

/** YYYY-MM-DD in UTC — capture days are UTC midnights, so this is lossless. */
export function captureDay(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d)
  return date.toISOString().slice(0, 10)
}

export type RosterValueDay = { leagueId: string; day: string; total: number; priced: number }

/**
 * Per league, per capture day since `since`: the summed value of the given players, and how many
 * of them were priced that day. A player with no row that day contributes nothing and is not
 * counted in `priced` — the caller compares `priced` with the roster size.
 */
export async function loadRosterValueSeries(args: {
  pairs: ReadonlyArray<{ leagueId: string; sleeperId: string }>
  book: ValueBookRef
  since: Date
  client?: RawClient
}): Promise<RosterValueDay[]> {
  const seen = new Set<string>()
  const leagueIds: string[] = []
  const sleeperIds: string[] = []
  for (const p of args.pairs) {
    if (!p.leagueId || !p.sleeperId) continue
    const k = `${p.leagueId}|${p.sleeperId}`
    if (seen.has(k)) continue
    seen.add(k)
    leagueIds.push(p.leagueId)
    sleeperIds.push(p.sleeperId)
  }
  if (leagueIds.length === 0) return []

  const rows = await client(args.client).$queryRaw<
    Array<{ leagueId: string; day: Date; total: bigint | number; priced: bigint | number }>
  >(Prisma.sql`
    SELECT m.lid AS "leagueId",
           p."capturedAt" AS day,
           SUM(p.value) AS total,
           COUNT(*) AS priced
    FROM unnest(${leagueIds}::text[], ${sleeperIds}::text[]) AS m(lid, sid)
    JOIN "PlayerValueSnapshot" p
      ON p."sleeperId" = m.sid
     AND p."source" = ${args.book.source}
     AND p."format" = ${args.book.format}
     AND p."qbFormat" = ${args.book.qbFormat}
     AND p."capturedAt" >= ${args.since}
    GROUP BY m.lid, p."capturedAt"
  `)
  return rows.map((r) => ({
    leagueId: r.leagueId,
    day: captureDay(r.day),
    total: Number(r.total),
    priced: Number(r.priced),
  }))
}

export type PlayerValuePoint = { sleeperId: string; day: string; value: number }

/** Every priced day since `since` for a SMALL set of players — the movers' sparklines. */
export async function loadPlayerValueHistory(args: {
  sleeperIds: readonly string[]
  book: ValueBookRef
  since: Date
  client?: RawClient
}): Promise<PlayerValuePoint[]> {
  const ids = [...new Set(args.sleeperIds.filter(Boolean))]
  if (ids.length === 0) return []
  const rows = await client(args.client).$queryRaw<Array<{ sleeperId: string; day: Date; value: number }>>(Prisma.sql`
    SELECT p."sleeperId", p."capturedAt" AS day, p.value
    FROM "PlayerValueSnapshot" p
    WHERE p."sleeperId" = ANY(${ids}::text[])
      AND p."source" = ${args.book.source}
      AND p."format" = ${args.book.format}
      AND p."qbFormat" = ${args.book.qbFormat}
      AND p."capturedAt" >= ${args.since}
    ORDER BY p."sleeperId", p."capturedAt"
  `)
  return rows.map((r) => ({ sleeperId: r.sleeperId, day: captureDay(r.day), value: Number(r.value) }))
}

export type PlayerValueWindow = { sleeperId: string; first: number; firstDay: string; last: number; lastDay: string }

/**
 * The earliest and latest priced value of each player inside the window, in two index probes per
 * player. Absent when the player has no row in the window at all.
 *
 * ⚠ THE WINDOW'S OWN FIRST ROW, NOT A ROW BEFORE IT. A player first priced mid-window moves from
 * his first price, not from zero — otherwise every newly priced player would read as a riser.
 */
export async function loadPlayerValueWindow(args: {
  sleeperIds: readonly string[]
  book: ValueBookRef
  since: Date
  client?: RawClient
}): Promise<PlayerValueWindow[]> {
  const ids = [...new Set(args.sleeperIds.filter(Boolean))]
  if (ids.length === 0) return []
  const rows = await client(args.client).$queryRaw<
    Array<{ sleeperId: string; first: number; firstDay: Date; last: number; lastDay: Date }>
  >(Prisma.sql`
    SELECT ids.sid AS "sleeperId",
           f.value AS first, f."capturedAt" AS "firstDay",
           l.value AS last,  l."capturedAt" AS "lastDay"
    FROM unnest(${ids}::text[]) AS ids(sid)
    CROSS JOIN LATERAL (
      SELECT p.value, p."capturedAt" FROM "PlayerValueSnapshot" p
      WHERE p."sleeperId" = ids.sid AND p."source" = ${args.book.source}
        AND p."format" = ${args.book.format} AND p."qbFormat" = ${args.book.qbFormat}
        AND p."capturedAt" >= ${args.since}
      ORDER BY p."capturedAt" ASC LIMIT 1
    ) f
    CROSS JOIN LATERAL (
      SELECT p.value, p."capturedAt" FROM "PlayerValueSnapshot" p
      WHERE p."sleeperId" = ids.sid AND p."source" = ${args.book.source}
        AND p."format" = ${args.book.format} AND p."qbFormat" = ${args.book.qbFormat}
        AND p."capturedAt" >= ${args.since}
      ORDER BY p."capturedAt" DESC LIMIT 1
    ) l
  `)
  return rows.map((r) => ({
    sleeperId: r.sleeperId,
    first: Number(r.first),
    firstDay: captureDay(r.firstDay),
    last: Number(r.last),
    lastDay: captureDay(r.lastDay),
  }))
}
