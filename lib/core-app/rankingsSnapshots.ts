import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { RankSnapshot } from '@/lib/core-app/rankingsEngine'

/**
 * Daily snapshots of the unfiltered Overall board — the history that 7-day and
 * weekly movement are measured against.
 *
 * ⚠ STORED IN `sportsDataCache`, NOT A NEW TABLE. A table is a migration, and a
 * migration is the user's call. One small JSON document per Eastern day, kept
 * for `SNAPSHOT_RETENTION_DAYS`, is exactly what that cache table already holds
 * for other features, and it needs no schema change to ship.
 *
 * ⚠ MOVEMENT IS ONLY EVER READ FROM WHAT WAS WRITTEN. Seven-day movement is not
 * reconstructed from today's ledger, because a board recomputed "as of last
 * week" from rows imported since would describe a week that never happened.
 * Until a snapshot exists for a date, movement against it is unknown and the
 * screen says when tracking started.
 *
 * ⚠ THE WRITER HAS A SCHEDULE. `runRankingsDailySnapshot` runs from
 * `/api/cron/domain-os-refresh` — a history nothing writes is worse than none,
 * because it reads as "nobody moved".
 */

export const SNAPSHOT_KEY_PREFIX = 'core-rankings:daily:v1:'
export const SNAPSHOT_RETENTION_DAYS = 400
/**
 * Rows kept per day. At today's population this is never reached; it bounds the
 * document if the board grows, and managers below the cut simply show no
 * movement rather than a wrong one.
 */
export const SNAPSHOT_MAX_ROWS = 5000

export function snapshotKey(dateKey: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${dateKey}`
}

function isSnapshot(value: unknown): value is RankSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<RankSnapshot>
  return typeof v.date === 'string' && typeof v.population === 'number' && Array.isArray(v.rows)
}

/** Snapshots for the given dates; a missing or malformed day is simply absent. */
export async function readRankSnapshots(dateKeys: string[]): Promise<Map<string, RankSnapshot>> {
  const keys = [...new Set(dateKeys)].map(snapshotKey)
  const out = new Map<string, RankSnapshot>()
  if (keys.length === 0) return out
  const rows = await prisma.sportsDataCache
    .findMany({ where: { cacheKey: { in: keys } }, select: { cacheKey: true, data: true } })
    .catch(() => [] as Array<{ cacheKey: string; data: unknown }>)
  for (const row of rows) {
    if (isSnapshot(row.data)) out.set(row.data.date, row.data)
  }
  return out
}

/** The earliest snapshot on record, so the screen can say when tracking began. */
export async function firstSnapshotDate(): Promise<string | null> {
  const row = await prisma.sportsDataCache
    .findFirst({
      where: { cacheKey: { startsWith: SNAPSHOT_KEY_PREFIX } },
      orderBy: { cacheKey: 'asc' },
      select: { cacheKey: true },
    })
    .catch(() => null)
  return row ? row.cacheKey.slice(SNAPSHOT_KEY_PREFIX.length) : null
}

export async function snapshotExists(dateKey: string): Promise<boolean> {
  const row = await prisma.sportsDataCache.findUnique({
    where: { cacheKey: snapshotKey(dateKey) },
    select: { cacheKey: true },
  })
  return row != null
}

export async function writeRankSnapshot(snapshot: RankSnapshot, now: Date = new Date()): Promise<void> {
  const data = { ...snapshot, rows: snapshot.rows.slice(0, SNAPSHOT_MAX_ROWS) } as unknown as Prisma.InputJsonValue
  const expiresAt = new Date(now.getTime() + SNAPSHOT_RETENTION_DAYS * 86_400_000)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: snapshotKey(snapshot.date) },
    create: { cacheKey: snapshotKey(snapshot.date), data, expiresAt },
    update: { data, expiresAt },
  })
}
