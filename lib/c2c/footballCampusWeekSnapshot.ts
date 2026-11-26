/**
 * The NFL C2C campus lineup as it stood each week (2026-11-24 audit fix).
 *
 * Campus starters live in the roster's CURRENT lineup (`lineup_sections.campus`), so rescoring an earlier
 * week used to read whatever the manager had set since. Every lineup save in a native NFL C2C league now
 * records that week's campus starters, and the campus scorer reads the latest record at or before the
 * week it scores: a lineup carries forward until the next save, and a later change never rewrites a past
 * week. A league with no record yet (saved before this existed) still reads the current lineup.
 *
 * Stored in `sportsDataCache`, the same place the NBA C2C weekly snapshot lives.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { campusStarterIds } from './campusLineup'

export type FootballCampusWeekSnapshot = { season: number; week: number; savedAt: string; starters: string[] }

const PREFIX = 'c2c:nfl:campus-week:'

export function footballCampusWeekKeyPrefix(redraftRosterId: string, season: number): string {
  return `${PREFIX}${encodeURIComponent(redraftRosterId)}:${season}:`
}

export function footballCampusWeekKey(redraftRosterId: string, season: number, week: number): string {
  return `${footballCampusWeekKeyPrefix(redraftRosterId, season)}${week}`
}

/** Save this week's campus starters with the lineup, in the lineup's transaction. */
export async function persistFootballCampusWeekSnapshot(
  db: Pick<Prisma.TransactionClient, 'sportsDataCache'>,
  input: { redraftRosterId: string; season: number; week: number; playerData: unknown; now: Date },
): Promise<void> {
  if (!input.redraftRosterId || !Number.isInteger(input.season) || !Number.isInteger(input.week) || input.week < 1) return
  const cacheKey = footballCampusWeekKey(input.redraftRosterId, input.season, input.week)
  const snapshot: FootballCampusWeekSnapshot = {
    season: input.season,
    week: input.week,
    savedAt: input.now.toISOString(),
    starters: campusStarterIds(input.playerData),
  }
  const data = toPrismaJsonInput(snapshot)
  const expiresAt = new Date(input.now.getTime() + 730 * 24 * 60 * 60 * 1000)
  await db.sportsDataCache.upsert({ where: { cacheKey }, create: { cacheKey, data, expiresAt }, update: { data, expiresAt } })
}

function readSnapshot(raw: unknown): FootballCampusWeekSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (!Number.isInteger(r.season) || !Number.isInteger(r.week) || !Array.isArray(r.starters)) return null
  return { season: r.season as number, week: r.week as number, savedAt: String(r.savedAt ?? ''), starters: (r.starters as unknown[]).map(String).filter(Boolean) }
}

/** Pure: the latest snapshot at or before `week` in `season`, or null. */
export function pickFootballCampusWeek(snapshots: readonly FootballCampusWeekSnapshot[], season: number, week: number): FootballCampusWeekSnapshot | null {
  let best: FootballCampusWeekSnapshot | null = null
  for (const s of snapshots) {
    if (s.season !== season || s.week > week) continue
    if (!best || s.week > best.week) best = s
  }
  return best
}

/**
 * Each roster's campus starters for this week from its snapshots; a roster with none is absent from the
 * map (the caller reads the current lineup for it).
 */
export async function loadFootballCampusWeekStarters(
  db: Pick<PrismaClient, 'sportsDataCache'>,
  input: { redraftRosterIds: readonly string[]; season: number; week: number },
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const ids = [...new Set(input.redraftRosterIds.filter(Boolean))]
  if (ids.length === 0) return out
  const rows = await db.sportsDataCache.findMany({
    where: { OR: ids.map((id) => ({ cacheKey: { startsWith: footballCampusWeekKeyPrefix(id, input.season) } })) },
    select: { cacheKey: true, data: true },
  })
  for (const id of ids) {
    const prefix = footballCampusWeekKeyPrefix(id, input.season)
    const snaps = rows.filter((r) => r.cacheKey.startsWith(prefix)).map((r) => readSnapshot(r.data)).filter((s): s is FootballCampusWeekSnapshot => s != null)
    const picked = pickFootballCampusWeek(snaps, input.season, input.week)
    if (picked) out.set(id, picked.starters)
  }
  return out
}
