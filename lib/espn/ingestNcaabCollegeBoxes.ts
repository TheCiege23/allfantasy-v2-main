import type { PrismaClient } from '@prisma/client'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { EspnBlockedError, fetchEspnCollegeBoxScore } from './espnNcaabFetch'
import type { EspnCollegeBoxScore } from './espnNcaabBoxScore'

export const ESPN_COLLEGE_BOX_KEY_PREFIX = 'espn:ncaab:box:'
const BOX_TTL_MS = 400 * 24 * 60 * 60 * 1000

/** Cache complete final ESPN boxes only; a partial response never replaces a good final. */
export async function ingestEspnCollegeBoxes(db: Pick<PrismaClient, 'sportsDataCache'>, input: {
  eventIds: readonly string[]
  deadlineAt: number
  maxEvents: number
  now: Date
  fetchBox?: (id: string) => Promise<EspnCollegeBoxScore>
}) {
  const ids = [...new Set(input.eventIds)].filter(id => /^\d+$/.test(id)).slice(0, Math.max(0, Math.min(20, input.maxEvents)))
  const fetchBox = input.fetchBox ?? fetchEspnCollegeBoxScore
  let stored = 0, rejected = 0, errors = 0, blocked = false, attempted = 0
  for (const eventId of ids) {
    if (Date.now() >= input.deadlineAt) break
    attempted++
    try {
      const box = await fetchBox(eventId)
      if (box.eventId !== eventId || box.status !== 'final' || !box.complete || box.rejected !== 0) { rejected++; continue }
      const cacheKey = `${ESPN_COLLEGE_BOX_KEY_PREFIX}${eventId}`
      const expiresAt = new Date(input.now.getTime() + BOX_TTL_MS)
      const data = toPrismaJsonInput({ ...box, observedAt: input.now.toISOString() })
      await db.sportsDataCache.upsert({ where: { cacheKey }, create: { cacheKey, data, expiresAt }, update: { data, expiresAt } })
      stored++
    } catch (err) {
      if (err instanceof EspnBlockedError) { blocked = true; break }
      errors++
    }
  }
  return { attempted, stored, rejected, errors, blocked, remaining: ids.length - attempted }
}
