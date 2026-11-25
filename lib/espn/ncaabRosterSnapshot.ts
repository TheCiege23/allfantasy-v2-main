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

/** Fresh ESPN class evidence scoped to the exact basketball season. Duplicate roster IDs are ambiguous. */
export async function readEspnNcaabClassYears(
  db: Pick<PrismaClient, 'sportsDataCache'>,
  seasonYear: number,
  now: Date,
): Promise<Map<string, number>> {
  const rows = await db.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: `${ESPN_NCAAB_ROSTER_KEY_PREFIX}${seasonYear}:` }, expiresAt: { gt: now } },
    select: { data: true },
  })
  const years = new Map<string, number>()
  const seen = new Set<string>()
  for (const { data } of rows) {
    const snapshot = data as Partial<EspnNcaabRosterSnapshot> | null
    if (snapshot?.seasonYear !== seasonYear || !Array.isArray(snapshot.athletes)) continue
    for (const athlete of snapshot.athletes) {
      if (typeof athlete?.id !== 'string' || !/^\d+$/.test(athlete.id)) continue
      if (seen.has(athlete.id)) {
        years.delete(athlete.id)
        continue
      }
      seen.add(athlete.id)
      const year = athlete.classYear
      if (typeof year === 'number' && Number.isInteger(year) && year >= 1 && year <= 4) years.set(athlete.id, year)
    }
  }
  return years
}

/** Every ESPN college basketball headshot lives under this path; the roster sweep writes no other. */
export const ESPN_NCAAB_HEADSHOT_PREFIX = 'https://a.espncdn.com/i/headshots/mens-college-basketball/'

export function isEspnNcaabHeadshot(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith(ESPN_NCAAB_HEADSHOT_PREFIX)
}

/**
 * ESPN athlete id → headshot, from the fresh roster snapshots of one basketball season. ESPN omits
 * the field when it has no photo (contracts/espn GAPS R-05), so absence here means "none", and an
 * athlete listed on two schools is dropped until a refresh settles the transfer.
 */
export async function readEspnNcaabHeadshots(
  db: Pick<PrismaClient, 'sportsDataCache'>,
  seasonYear: number,
  now: Date,
): Promise<Map<string, string>> {
  const rows = await db.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: `${ESPN_NCAAB_ROSTER_KEY_PREFIX}${seasonYear}:` }, expiresAt: { gt: now } },
    select: { data: true },
  })
  const photos = new Map<string, string>()
  const seen = new Set<string>()
  for (const { data } of rows) {
    const snapshot = data as Partial<EspnNcaabRosterSnapshot> | null
    if (snapshot?.seasonYear !== seasonYear || !Array.isArray(snapshot.athletes)) continue
    for (const athlete of snapshot.athletes) {
      if (typeof athlete?.id !== 'string' || !/^\d+$/.test(athlete.id)) continue
      if (seen.has(athlete.id)) {
        photos.delete(athlete.id)
        continue
      }
      seen.add(athlete.id)
      if (isEspnNcaabHeadshot(athlete.headshotUrl)) photos.set(athlete.id, athlete.headshotUrl)
    }
  }
  return photos
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
