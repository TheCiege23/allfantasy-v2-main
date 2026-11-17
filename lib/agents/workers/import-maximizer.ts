import 'server-only'

import pLimit from 'p-limit'

import { prisma } from '@/lib/prisma'
import { syncLeague } from '@/lib/league-sync-core'
import { SYSTEM_LEAGUE_OWNER_ID } from '@/lib/league-import/systemLeagueOwner'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'

export interface ImportMaximizerLeagueResult {
  leagueId: string
  leagueName: string
  platform: string
  userId: string
  lastSyncedAt: string | null
  status: 'fresh' | 'stale' | 'resynced' | 'failed'
  error?: string
}

export interface ImportMaximizerResult {
  startedAt: string
  completedAt: string
  staleAfterHours: number
  totals: {
    total: number
    fresh: number
    stale: number
    resynced: number
    failed: number
  }
  leagues: ImportMaximizerLeagueResult[]
}

function isStale(lastSyncedAt: Date | null, staleAfterHours: number): boolean {
  if (!lastSyncedAt) return true
  return Date.now() - lastSyncedAt.getTime() > staleAfterHours * 60 * 60 * 1000
}

async function notifyLeagueResync(userId: string, leagueName: string, leagueId: string) {
  await dispatchNotification({
    userIds: [userId],
    category: 'system_account',
    productType: 'app',
    type: 'league_sync_stale',
    title: 'League data is out of date',
    body: `Your ${leagueName} league data was stale. A sync has started automatically so AI recommendations can use current data.`,
    actionHref: `/leagues/${leagueId}`,
    actionLabel: 'Open league',
    meta: { leagueId, leagueName },
    severity: 'high',
  })
}

export async function runImportMaximizer(args?: {
  staleAfterHours?: number
  maxLeagues?: number
  notifyUsers?: boolean
}): Promise<ImportMaximizerResult> {
  const startedAt = new Date().toISOString()
  const staleAfterHours = Math.max(1, Math.min(72, Math.round(args?.staleAfterHours ?? 24)))
  const maxLeagues = Math.max(1, Math.min(250, Math.round(args?.maxLeagues ?? 100)))
  const notifyUsers = args?.notifyUsers !== false

  const leagues = await prisma.league.findMany({
    take: maxLeagues,
    /*
     * Not the AllFantasy system account's leagues. It owns public ESPN leagues people joined by
     * picking a team; the legacy `syncLeague` below needs the OWNER's cookies (it has none), so every
     * run failed them and sent "out of date" notices to an account nobody reads. The import collector
     * refreshes them instead — see `connectionReadableWithoutCredential`.
     */
    where: { userId: { not: SYSTEM_LEAGUE_OWNER_ID } },
    orderBy: [{ lastSyncedAt: 'asc' }, { updatedAt: 'asc' }],
    select: {
      id: true,
      name: true,
      userId: true,
      platform: true,
      platformLeagueId: true,
      lastSyncedAt: true,
    },
  })

  const limit = pLimit(3)
  const results = await Promise.all(
    leagues.map((league) =>
      limit(async (): Promise<ImportMaximizerLeagueResult> => {
        const leagueName = league.name?.trim() || `${league.platform.toUpperCase()} league`
        const stale = isStale(league.lastSyncedAt, staleAfterHours)
        if (!stale) {
          return {
            leagueId: league.id,
            leagueName,
            platform: league.platform,
            userId: league.userId,
            lastSyncedAt: league.lastSyncedAt?.toISOString() ?? null,
            status: 'fresh',
          }
        }

        if (notifyUsers) {
          await notifyLeagueResync(league.userId, leagueName, league.id).catch(() => {})
        }

        try {
          await syncLeague(league.userId, league.platform.toLowerCase(), league.platformLeagueId)
          return {
            leagueId: league.id,
            leagueName,
            platform: league.platform,
            userId: league.userId,
            lastSyncedAt: league.lastSyncedAt?.toISOString() ?? null,
            status: 'resynced',
          }
        } catch (error) {
          return {
            leagueId: league.id,
            leagueName,
            platform: league.platform,
            userId: league.userId,
            lastSyncedAt: league.lastSyncedAt?.toISOString() ?? null,
            status: 'failed',
            error: error instanceof Error ? error.message : 'League sync failed',
          }
        }
      })
    )
  )

  const totals = {
    total: results.length,
    fresh: results.filter((entry) => entry.status === 'fresh').length,
    stale: results.filter((entry) => entry.status !== 'fresh').length,
    resynced: results.filter((entry) => entry.status === 'resynced').length,
    failed: results.filter((entry) => entry.status === 'failed').length,
  }

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    staleAfterHours,
    totals,
    leagues: results,
  }
}
