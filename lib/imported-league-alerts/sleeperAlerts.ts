import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { acquireAutomationLock, releaseAutomationLock } from '@/lib/automation/locks'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import type { LeagueSyncConnection } from '@/lib/import-os/collector/types'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import { deriveSleeperAlerts, type SleeperAlertSnapshot } from './sleeperEvents'

function readSnapshot(value: unknown): SleeperAlertSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const row = value as SleeperAlertSnapshot
  return row.version === 1 && Number.isFinite(Date.parse(row.observedAt)) && Array.isArray(row.completedTrades) &&
    row.drafts && typeof row.drafts === 'object' ? row : null
}

/** Called after successful scheduled/manual sync. Reuses that run's normalized payload. */
export async function processSleeperImportedAlerts(
  connection: LeagueSyncConnection,
  normalized: NormalizedImportResult,
  observedAt: Date,
): Promise<void> {
  if (connection.provider !== 'sleeper' || normalized.source.source_provider !== 'sleeper' ||
      normalized.source.source_league_id !== connection.externalLeagueId || normalized.league.season !== connection.season) return
  // Partial responses must not advance a baseline or manufacture events on recovery.
  if (normalized.fetchWarnings?.length || normalized.fetch_warnings?.length || normalized.rosters.some((r) => r.fetch_status === 'failed')) return
  const mirrors = await prisma.league.findMany({
    where: { platform: 'sleeper', platformLeagueId: connection.externalLeagueId, season: connection.season },
    select: { id: true, userId: true },
  })
  const failedMirrors: string[] = []
  for (const league of mirrors) {
    const lockKey = `imported-alerts:sleeper:${league.id}`
    const owner = `imported-alerts:${randomUUID()}`
    const lock = await acquireAutomationLock(lockKey, { owner, ttlMs: 5 * 60_000 })
    if (!lock.ok) continue
    try {
      // Include the account in the key: transferring a mirror establishes a new baseline.
      const cacheKey = `imported-alerts:v1:sleeper:${league.id}:${league.userId}`
      const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } })
      const previous = cached && cached.expiresAt > observedAt ? readSnapshot(cached.data) : null
      if (previous && Date.parse(previous.observedAt) >= observedAt.getTime()) continue
      const profile = await prisma.userProfile.findUnique({ where: { userId: league.userId }, select: { sleeperUserId: true } })
      const own = profile?.sleeperUserId
        ? normalized.rosters.find((r) => r.source_manager_id === profile.sleeperUserId)
        : undefined
      // Never assume the importer owns roster 1, the first roster, or the commissioner's team.
      const { snapshot, events } = deriveSleeperAlerts(normalized, previous, own?.source_team_id ?? null, observedAt)
      for (const event of events) {
        const digest = createHash('sha256').update(JSON.stringify([
          connection.externalLeagueId, connection.season, league.userId, event.category, previous?.observedAt, event.identity,
        ])).digest('hex')
        const result = await dispatchNotification({
          userIds: [league.userId], leagueId: league.id, productType: 'app',
          category: event.category, type: event.category,
          title: `Sleeper · ${normalized.league.name}: ${event.title}`, body: event.body,
          actionHref: `/league/${encodeURIComponent(league.id)}`, actionLabel: 'View league',
          dedupePrefix: `imported-sleeper:${digest}`, severity: 'low',
          meta: { leagueId: league.id, provider: 'sleeper', externalLeagueId: connection.externalLeagueId,
            sport: connection.sport, importedLeagueAlert: true, observedAt: observedAt.toISOString() },
        })
        // Dispatcher reports failures instead of throwing. Preserve the baseline for retry.
        if (result.failed > 0) throw new Error(`Imported Sleeper alert delivery failed: ${event.category}`)
      }
      const data = snapshot as unknown as Prisma.InputJsonValue
      const expiresAt = new Date(observedAt.getTime() + 365 * 24 * 60 * 60_000)
      await prisma.sportsDataCache.upsert({
        where: { cacheKey }, create: { cacheKey, data, expiresAt }, update: { data, expiresAt },
      })
    } catch (error: unknown) {
      // One importer's settings or store failure must not starve other mirrors.
      failedMirrors.push(league.id)
      console.warn('[imported-alerts] Sleeper mirror failed', league.id, error instanceof Error ? error.message : error)
    } finally {
      await releaseAutomationLock(lockKey, owner)
    }
  }
  if (failedMirrors.length) throw new Error(`Imported Sleeper alert delivery failed for ${failedMirrors.length} mirror(s)`)
}
