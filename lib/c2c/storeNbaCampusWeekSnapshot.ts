import type { Prisma } from '@prisma/client'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { currentNcaabRosterEvidence } from '@/lib/devy/ncaabRosterPool'
import { buildNbaCampusWeekSnapshot, type NbaCampusWeekSnapshot } from './nbaCampusWeekSnapshot'

export function nbaCampusWeekCacheKey(leagueId: string, rosterId: string, season: number, week: number): string {
  return `c2c:nba:weekly:${encodeURIComponent(leagueId)}:${encodeURIComponent(rosterId)}:${season}:${week}`
}

/** Prepare week-specific school evidence before the lineup transaction. */
export async function prepareNbaCampusWeekSnapshot(db: Pick<Prisma.TransactionClient, 'sportsDataCache'>, input: {
  leagueId: string; rosterId: string; season: number; week: number; playerData: unknown; now: Date
}) {
  const cacheKey = nbaCampusWeekCacheKey(input.leagueId, input.rosterId, input.season, input.week)
  const previousRow = await db.sportsDataCache.findUnique({ where: { cacheKey } })
  const raw = previousRow?.data
  const previous = raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as Record<string, unknown>).players) ? raw as unknown as NbaCampusWeekSnapshot : null
  const evidence = await currentNcaabRosterEvidence(db, input.now)
  const result = buildNbaCampusWeekSnapshot({ ...input, evidence: evidence.athletes, previous })
  return result
}

/** Persist the prepared evidence in the same transaction as its lineup. */
export async function persistNbaCampusWeekSnapshot(db: Pick<Prisma.TransactionClient, 'sportsDataCache'>, input: {
  leagueId: string; rosterId: string; snapshot: NbaCampusWeekSnapshot; now: Date
}) {
  const { snapshot } = input
  const cacheKey = nbaCampusWeekCacheKey(input.leagueId, input.rosterId, snapshot.season, snapshot.week)
  const data = toPrismaJsonInput(snapshot)
  const expiresAt = new Date(input.now.getTime() + 730 * 24 * 60 * 60 * 1000)
  await db.sportsDataCache.upsert({ where: { cacheKey }, create: { cacheKey, data, expiresAt }, update: { data, expiresAt } })
}
