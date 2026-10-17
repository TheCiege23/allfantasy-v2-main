import 'server-only'

import { prisma } from '@/lib/prisma'
import { checkIn, dayKey, parseStreakRecord, summarizeStreak, type StreakRecord, type StreakSummary } from './dailyStreak'

/**
 * Where a manager's check-in streak lives: one `SportsDataCache` row per user, beside the "since
 * your last visit" marker (`core-visit:v1:`) and on the same terms — no migration, no route.
 *
 * ⚠ THE PURGE IS AN ALLOW-LIST, SO THIS ROW SURVIVES IT. `purgeExpiredCache` (lib/enrichment-cache.ts)
 * deletes only the prefixes it names; `core-streak:` is not one, and must not become one — a purge
 * would silently reset every streak to day 1. `expiresAt` is set a year out for the record only.
 */
export const STREAK_KEY_PREFIX = 'core-streak:v1:'
const ROW_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000

async function readRecord(userId: string): Promise<StreakRecord | null> {
  const row = await prisma.sportsDataCache
    .findUnique({ where: { cacheKey: `${STREAK_KEY_PREFIX}${userId}` }, select: { data: true } })
    .catch(() => null)
  return parseStreakRecord(row?.data)
}

async function writeRecord(userId: string, record: StreakRecord, now: Date): Promise<boolean> {
  const data = record as unknown as object
  const expiresAt = new Date(now.getTime() + ROW_LIFETIME_MS)
  return prisma.sportsDataCache
    .upsert({
      where: { cacheKey: `${STREAK_KEY_PREFIX}${userId}` },
      update: { data, expiresAt },
      create: { cacheKey: `${STREAK_KEY_PREFIX}${userId}`, data, expiresAt },
    })
    .then(() => true)
    .catch(() => false)
}

/**
 * The streak for this render, checking in first when `record` is true (a real, unfiltered home visit).
 *
 * ⚠ A FAILED WRITE IS REPORTED AS NOT CHECKED IN, never as a streak that advanced: the card must not
 * celebrate "Day 5" over a row that did not save, because tomorrow would then read "Day 1".
 */
export async function loadDailyStreak(
  userId: string,
  now: Date,
  opts: { record: boolean },
): Promise<StreakSummary> {
  const today = dayKey(now)
  const before = await readRecord(userId)
  if (!opts.record || before?.days.includes(today)) return summarizeStreak(before, before, today)
  const after = checkIn(before, today)
  const saved = await writeRecord(userId, after, now)
  return saved ? summarizeStreak(before, after, today) : summarizeStreak(before, before, today)
}
