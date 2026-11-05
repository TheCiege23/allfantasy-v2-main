import type { PrismaClient } from '@prisma/client'
import { normalizePlayerName } from '@/lib/team-abbrev'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { ESPN_NCAAB_ROSTER_KEY_PREFIX, currentNcaabSeasonYear } from '@/lib/espn/ncaabRosterSnapshot'
import { selectCurrentNcaabAthletes } from './ncaabRosterEvidence'

const SOURCE = 'espn_ncaab_roster'
const MAX_CREATE = 100
const MAX_UPDATE = 100
const CURSOR_KEY = 'devy:ncaab:espn-roster-cursor'
type Cursor = { create: string; update: string }

/** Walk after the last attempted ID and wrap; collisions cannot pin every later candidate. */
function nextBatch<T extends { id: string }>(rows: T[], after: string, limit: number): T[] {
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id))
  const start = ordered.findIndex((p) => p.id.localeCompare(after) > 0)
  const pivot = start < 0 ? 0 : start
  return [...ordered.slice(pivot), ...ordered.slice(0, pivot)].slice(0, limit)
}

type Db = Pick<PrismaClient, 'sportsDataCache' | 'devyPlayer'>

/** Read persisted provider evidence only. Ambiguous or stale athletes are not draftable. */
export async function currentNcaabRosterEvidence(db: Pick<Db, 'sportsDataCache'>, now: Date) {
  const rows = await db.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: `${ESPN_NCAAB_ROSTER_KEY_PREFIX}${currentNcaabSeasonYear(now)}:` }, expiresAt: { gt: now } },
    select: { cacheKey: true, data: true, expiresAt: true },
  })
  return selectCurrentNcaabAthletes(rows, now)
}

/** Incrementally materialize current roster athletes with stable, provider-scoped IDs.
 * Never update a different source's row or reset an existing player's eligibility. A
 * name/position/school uniqueness collision is skipped rather than taking another player's row. */
export async function materializeNcaabRosterPool(db: Db, input: { now: Date; deadlineAt: number }) {
  const evidence = await currentNcaabRosterEvidence(db, input.now)
  const ids = evidence.athletes.map((p) => p.id)
  if (!ids.length || Date.now() >= input.deadlineAt) return { candidates: ids.length, created: 0, updated: 0, skipped: 0, ambiguous: evidence.ambiguous.length }
  const checkpoint = await db.sportsDataCache.findUnique({ where: { cacheKey: CURSOR_KEY } })
  const raw = checkpoint?.data && typeof checkpoint.data === 'object' && !Array.isArray(checkpoint.data) ? checkpoint.data as Record<string, unknown> : {}
  const cursor: Cursor = { create: typeof raw.create === 'string' ? raw.create : '', update: typeof raw.update === 'string' ? raw.update : '' }
  const existing = await db.devyPlayer.findMany({ where: { id: { in: ids } }, select: { id: true, sport: true, source: true, lastSyncedAt: true } })
  const byId = new Map(existing.map((p) => [p.id, p]))
  const fresh = nextBatch(evidence.athletes.filter((p) => !byId.has(p.id)), cursor.create, MAX_CREATE)
  let created = 0
  if (fresh.length && Date.now() < input.deadlineAt) {
    const result = await db.devyPlayer.createMany({ skipDuplicates: true, data: fresh.map((p) => ({
      id: p.id, name: p.name, normalizedName: normalizePlayerName(p.name), position: p.position, school: p.school,
      sport: 'NCAAB', source: SOURCE, ncaaSourceTag: 'ncaab_espn', lastRosterYear: currentNcaabSeasonYear(input.now),
      jerseyNumber: p.jersey?.slice(0, 16) ?? null, devyEligible: true, graduatedToNFL: false,
      draftStatus: 'college', statusSource: SOURCE, statusConfidence: 90, statusUpdatedAt: p.observedAt, lastSyncedAt: p.observedAt,
    })) })
    created = result.count
    cursor.create = fresh[fresh.length - 1]!.id
  }
  let updated = 0
  let skipped = fresh.length - created
  const changed = nextBatch(evidence.athletes.filter((p) => {
    const row = byId.get(p.id)
    return row?.sport === 'NCAAB' && row.source === SOURCE && row.lastSyncedAt.getTime() < p.observedAt.getTime()
  }), cursor.update, MAX_UPDATE)
  for (const p of changed) {
    if (Date.now() >= input.deadlineAt) break
    cursor.update = p.id
    try {
      const result = await db.devyPlayer.updateMany({
        where: { id: p.id, sport: 'NCAAB', source: SOURCE, lastSyncedAt: { lt: p.observedAt } },
        data: { name: p.name, normalizedName: normalizePlayerName(p.name), position: p.position, school: p.school,
          jerseyNumber: p.jersey?.slice(0, 16) ?? null, lastRosterYear: currentNcaabSeasonYear(input.now), lastSyncedAt: p.observedAt },
      })
      updated += result.count
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') { skipped++; continue }
      throw error
    }
  }
  const data = toPrismaJsonInput(cursor)
  const expiresAt = new Date(input.now.getTime() + 30 * 24 * 60 * 60 * 1000)
  await db.sportsDataCache.upsert({ where: { cacheKey: CURSOR_KEY }, create: { cacheKey: CURSOR_KEY, data, expiresAt }, update: { data, expiresAt } })
  return { candidates: ids.length, created, updated, skipped, ambiguous: evidence.ambiguous.length }
}
