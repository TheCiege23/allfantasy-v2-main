import type { PrismaClient } from '@prisma/client'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import type { EspnNcaabAthlete } from './espnNcaabFetch'

/** A successful, season-qualified school roster, retained independently of photo matches. */
export type EspnNcaabRosterSnapshot = {
  seasonYear: number
  teamId: string
  school: string
  observedAt: string
  athletes: EspnNcaabAthlete[]
}

export const ESPN_NCAAB_ROSTER_KEY_PREFIX = 'espn:ncaab:roster:'
const SNAPSHOT_TTL_MS = 45 * 24 * 60 * 60 * 1000

/** ESPN labels a 2026–27 basketball season as 2027. */
export function currentNcaabSeasonYear(now: Date): number {
  return now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0)
}

/** Refuse an empty, wrong-season, malformed, or internally ambiguous response. */
export function makeEspnNcaabRosterSnapshot(input: {
  seasonYear: number | null
  teamId: string
  school: string | null
  athletes: EspnNcaabAthlete[]
  rejectedCount?: number
  now: Date
}): EspnNcaabRosterSnapshot | null {
  const { seasonYear, teamId, athletes, now } = input
  const school = input.school?.trim()
  if (seasonYear !== currentNcaabSeasonYear(now) || !/^\d+$/.test(teamId) || !school || athletes.length === 0 || (input.rejectedCount ?? 0) > 0) return null
  const ids = new Set<string>()
  for (const athlete of athletes) {
    if (!/^\d+$/.test(athlete.id) || !athlete.fullName.trim() || ids.has(athlete.id)) return null
    ids.add(athlete.id)
  }
  return { seasonYear, teamId, school, observedAt: now.toISOString(), athletes }
}

export async function storeEspnNcaabRosterSnapshot(
  db: Pick<PrismaClient, 'sportsDataCache'>,
  snapshot: EspnNcaabRosterSnapshot,
): Promise<void> {
  const cacheKey = `${ESPN_NCAAB_ROSTER_KEY_PREFIX}${snapshot.seasonYear}:${snapshot.teamId}`
  const expiresAt = new Date(new Date(snapshot.observedAt).getTime() + SNAPSHOT_TTL_MS)
  const data = toPrismaJsonInput(snapshot)
  await db.sportsDataCache.upsert({
    where: { cacheKey },
    create: { cacheKey, data, expiresAt },
    update: { data, expiresAt },
  })
}
