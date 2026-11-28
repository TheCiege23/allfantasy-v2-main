/**
 * Where a pasted Yahoo league waits between pastes, and where preview/commit read it from.
 *
 * ⚠ THE GENERIC `SportsDataCache` TABLE, ON PURPOSE AND FOR NOW. It needs no migration, and a
 * snapshot is genuinely short-lived working state: it exists to be imported, then the league row is
 * the record. Owner decision 2026-11-14. If snapshots ever need to outlive 30 days or be listed per
 * user, that is the point to give them their own table.
 *
 * 🛑 THE USER ID IS IN THE KEY, AND THAT IS THE ACCESS CONTROL. Like Fantrax uploads, a snapshot is
 * readable only by the account that pasted it — `yahoo-snapshot:<id>` in a preview from anyone else
 * resolves to nothing. Two commissioners pasting the same league get two snapshots.
 */
import { prisma } from '@/lib/prisma'
import { YahooImportLeagueNotFoundError } from '@/lib/league-import/yahoo/YahooLeagueFetchService'
import type { YahooImportPayload } from '@/lib/league-import/adapters/yahoo/types'
import { buildYahooSnapshotPayload, parseYahooSnapshotSourceId } from './yahooSnapshotModel'
import { resolveYahooSnapshotPlayerIds } from './yahooSnapshotPlayerIdResolver'
import { emptyYahooSnapshot, type YahooLeagueSnapshot } from './yahooSnapshotTypes'

const TTL_MS = 30 * 24 * 60 * 60 * 1000

function cacheKey(userId: string, leagueId: string): string {
  return `yahoo-snapshot:v1:${userId}:${leagueId}`
}

function isSnapshot(value: unknown, leagueId: string): value is YahooLeagueSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<YahooLeagueSnapshot>
  return v.version === 1 && v.leagueId === leagueId && typeof v.rosters === 'object' && v.rosters !== null
}

/** The stored snapshot, or null when there is none (or it expired). Never another user's. */
export async function loadYahooSnapshot(userId: string, leagueId: string): Promise<YahooLeagueSnapshot | null> {
  const row = await prisma.sportsDataCache.findUnique({
    where: { cacheKey: cacheKey(userId, leagueId) },
    select: { data: true, expiresAt: true },
  })
  if (!row || row.expiresAt.getTime() <= Date.now()) return null
  return isSnapshot(row.data, leagueId) ? row.data : null
}

export async function loadOrStartYahooSnapshot(userId: string, leagueId: string): Promise<YahooLeagueSnapshot> {
  return (await loadYahooSnapshot(userId, leagueId)) ?? emptyYahooSnapshot(leagueId)
}

export async function saveYahooSnapshot(userId: string, snapshot: YahooLeagueSnapshot): Promise<void> {
  const key = cacheKey(userId, snapshot.leagueId)
  const expiresAt = new Date(Date.now() + TTL_MS)
  const data = snapshot as unknown as object
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: key },
    create: { cacheKey: key, expiresAt, data },
    update: { expiresAt, data },
  })
}

export async function deleteYahooSnapshot(userId: string, leagueId: string): Promise<void> {
  await prisma.sportsDataCache.deleteMany({ where: { cacheKey: cacheKey(userId, leagueId) } })
}

/**
 * The import payload for `yahoo-snapshot:<id>`, as THIS user pasted it. Throws
 * `YahooImportLeagueNotFoundError` when there is no snapshot, so the pipeline and the commissioner
 * gate report it exactly as they report a Yahoo league that does not exist.
 */
export async function loadYahooSnapshotPayload(userId: string, sourceId: string): Promise<YahooImportPayload> {
  const leagueId = parseYahooSnapshotSourceId(sourceId)
  const snapshot = leagueId ? await loadYahooSnapshot(userId, leagueId) : null
  if (!snapshot) {
    throw new YahooImportLeagueNotFoundError(
      'That pasted Yahoo league was not found — it may have expired. Paste your league pages again.',
    )
  }
  /*
   * Pasted players are resolved to our own ids HERE, so preview and commit both see them and the
   * league is stored with ids every screen reads. A re-import ("Update my existing league") of a
   * league stored before this existed rewrites its rosters with the resolved ids.
   */
  return (await resolveYahooSnapshotPlayerIds(buildYahooSnapshotPayload(snapshot))).payload
}
