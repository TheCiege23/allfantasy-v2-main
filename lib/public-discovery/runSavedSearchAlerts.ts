import { prisma } from "@/lib/prisma"
import { createPlatformNotification } from "@/lib/platform/notification-service"
import { resolveUserCareerTier } from "@/lib/ranking/tier-visibility"
import { readAccountGeoLockFresh } from "@/lib/geo/accountGeoLockServer"
import { discoverPublicLeagues } from "./PublicDiscoveryService"
import { RECHECK_AFTER_MS, checkSavedSearch, discoverInputFromQuery } from "./savedSearchAlerts"

export interface SavedSearchAlertsRun {
  due: number
  checked: number
  alerted: number
  errors: string[]
  /** Stopped at the time budget with searches still due; the next day picks them up first. */
  budgetExhausted: boolean
}

/**
 * The daily saved-search check (see savedSearchAlerts.ts), run from /api/cron/morning-briefing.
 *
 * Oldest-checked first, inside a time budget, one search at a time: each is a full discovery read
 * for its owner, and the route it rides on has other work to finish. A failure is recorded and
 * the next search runs — one bad row never stops the rest.
 */
export async function runSavedSearchAlerts(options: {
  baseUrl: string
  now?: Date
  budgetMs?: number
  take?: number
}): Promise<SavedSearchAlertsRun> {
  const now = options.now ?? new Date()
  const started = Date.now()
  const budgetMs = options.budgetMs ?? 60_000
  const dueBefore = new Date(now.getTime() - RECHECK_AFTER_MS)

  const due = await prisma.savedLeagueSearch.findMany({
    where: { OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: dueBefore } }] },
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }],
    take: options.take ?? 300,
    select: { id: true, userId: true, label: true, query: true, seenLeagueIds: true, lastCheckedAt: true },
  })

  const run: SavedSearchAlertsRun = { due: due.length, checked: 0, alerted: 0, errors: [], budgetExhausted: false }
  for (const search of due) {
    if (Date.now() - started > budgetMs) {
      run.budgetExhausted = true
      break
    }
    try {
      const [viewerTier, lock] = await Promise.all([
        resolveUserCareerTier(prisma as never, search.userId, 1),
        readAccountGeoLockFresh(search.userId).catch(() => undefined),
      ])
      const input = discoverInputFromQuery(search.query)
      // An account locked by its billing state never hears about a paid league: a paid-only
      // search finds nothing, any other finds free leagues only.
      let results: Awaited<ReturnType<typeof discoverPublicLeagues>>["leagues"] = []
      if (!(lock && input.entryFee === "paid")) {
        if (lock) input.entryFee = "free"
        results = (await discoverPublicLeagues(input, options.baseUrl, { viewerTier, viewerUserId: search.userId })).leagues
      }

      const check = checkSavedSearch({
        label: search.label,
        seenLeagueIds: search.seenLeagueIds,
        firstCheck: search.lastCheckedAt == null,
        results,
      })
      if (check.alert) {
        await createPlatformNotification({
          userId: search.userId,
          type: "find_league_saved_search",
          title: check.alert.title,
          body: check.alert.body,
          severity: "low",
          meta: { actionHref: `/find-league?${search.query}`, savedSearchId: search.id },
          sourceKey: `find-league-saved:${search.id}:${now.toISOString().slice(0, 10)}`,
        })
        run.alerted += 1
      }
      await prisma.savedLeagueSearch.update({
        where: { id: search.id },
        data: { seenLeagueIds: check.seen, lastCheckedAt: now, ...(check.alert ? { lastAlertedAt: now } : {}) },
      })
      run.checked += 1
    } catch (err) {
      run.errors.push(`${search.id}: ${err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120)}`)
    }
  }
  return run
}
