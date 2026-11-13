import 'server-only'

import { prisma } from '@/lib/prisma'
import type { TradeValuationGap } from '@/lib/decision-os/trade/tradeGrade'

export type CollusionValuation =
  | { status: 'priced'; percentDiff: number }
  | { status: 'unavailable'; reason: string; gap?: TradeValuationGap }

const cacheKeyFor = (leagueId: string) => 'collusion-valuation:v1:' + leagueId
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** The last recorded trade check, including checks that raised no flag. */
export async function readCollusionValuation(leagueId: string): Promise<CollusionValuation | null> {
  try {
    const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: cacheKeyFor(leagueId) } })
    if (!row || row.expiresAt.getTime() <= Date.now() || !row.data || typeof row.data !== 'object') return null
    const data = row.data as Partial<CollusionValuation>
    if (data.status === 'priced' && typeof data.percentDiff === 'number') return { status: 'priced', percentDiff: data.percentDiff }
    if (data.status === 'unavailable' && typeof data.reason === 'string') return { status: 'unavailable', reason: data.reason, ...(data.gap ? { gap: data.gap } : {}) }
  } catch {
    // Older test stores and an unavailable cache leave this view unknown.
  }
  return null
}

export async function recordCollusionValuation(leagueId: string, data: CollusionValuation, now: Date): Promise<void> {
  const cacheKey = cacheKeyFor(leagueId)
  const expiresAt = new Date(now.getTime() + RETENTION_MS)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    create: { cacheKey, data, expiresAt },
    update: { data, expiresAt },
  })
}
