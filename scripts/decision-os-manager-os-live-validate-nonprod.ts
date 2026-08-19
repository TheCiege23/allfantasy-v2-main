/**
 * Phase OS-C4 — Manager OS real-data certification runner (read-only, non-prod).
 *
 * Runs the ACTUAL Manager OS composition pipeline — `getDashboardLeagueListForUser` →
 * `resolveManagerCommandCenterSnapshot` → `composeDailyBrief` → `composeNotificationFeed` →
 * `resolveDeliveryPlan` — against a real, already-imported league in a non-prod database. This is
 * the exact same code every request to `/api/decision-os/manager-command-center` runs; this script
 * only replaces the HTTP/session shell with a direct function call, the same discipline
 * `decision-os-import-sleeper-nonprod.ts` and `decision-os-suite-conformance.ts` already established.
 *
 * Read-only: makes zero writes. HARD-REFUSES the production DB host (ep-spring-tooth) and skips
 * cleanly without DATABASE_URL, matching every other `*-nonprod.ts` script's own boundary.
 *
 *     DATABASE_URL=<non-prod db> npx tsx scripts/decision-os-manager-os-live-validate-nonprod.ts --userId=<id>
 *
 * Options:
 *   --userId=<id>   AppUser.id to validate as (required — must own at least one claimed team).
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'

const PROD_HOST_MARKER = 'ep-spring-tooth'

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function hostOf(url: string | null): string {
  if (!url) return '?'
  try {
    return new URL(url.replace(/^postgres(ql)?:\/\//, 'http://')).host
  } catch {
    return '?'
  }
}

;(async () => {
  // Gate BEFORE importing anything that pulls the prisma singleton.
  if (!hasDatabaseUrl()) {
    console.log('SKIPPED (no DATABASE_URL) — set a NON-PROD DATABASE_URL to run this validation.')
    process.exit(0)
  }
  const host = hostOf(resolveDatabaseUrl())
  if (host.includes(PROD_HOST_MARKER)) {
    console.error(`REFUSED: resolved DB host (${host}) is the PRODUCTION host (${PROD_HOST_MARKER}). This runner must NEVER touch production, even read-only.`)
    process.exit(1)
  }
  console.log(`Target DB host: ${host} (confirmed non-production)`)

  const userId = arg('userId')
  if (!userId) {
    console.error('Usage: DATABASE_URL=<non-prod db> npx tsx scripts/decision-os-manager-os-live-validate-nonprod.ts --userId=<id>')
    process.exit(1)
  }

  const { getDashboardLeagueListForUser } = await import('../lib/dashboard/get-dashboard-league-list')
  const { resolveManagerCommandCenterSnapshot } = await import('../lib/decision-os/managerCommandCenter')
  const { composeDailyBrief } = await import('../lib/decision-os/dailyBrief')
  const { composeNotificationFeed } = await import('../lib/decision-os/notifications')
  const { resolveDeliveryPlan } = await import('../lib/decision-os/delivery/deliveryResolver')
  const { prisma } = await import('../lib/prisma')

  console.log(`\n=== Step 1: getDashboardLeagueListForUser('${userId}') — real query, no isCommissioner filter ===`)
  const payload = await getDashboardLeagueListForUser(userId)
  const leagues = (payload.leagues as { id: string; name: string; isCommissioner?: boolean; userRole?: string }[]) ?? []
  console.log(`Real leagues found: ${leagues.length}`)
  for (const l of leagues) {
    console.log(`  - ${l.name} (${l.id}) role=${l.userRole} isCommissioner=${l.isCommissioner}`)
  }
  const leagueIds = leagues.map((l) => l.id)

  console.log(`\n=== Step 2: resolveManagerCommandCenterSnapshot (the EXACT function the real API route calls) ===`)
  const now = new Date()
  const snapshot = await resolveManagerCommandCenterSnapshot(userId, leagueIds, now)
  console.log(JSON.stringify(snapshot, null, 2))

  console.log(`\n=== Step 3: draftsApproachingCount (same query the real route runs) ===`)
  let draftsApproachingCount = 0
  if (leagueIds.length > 0) {
    const windowEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
    draftsApproachingCount = await (prisma as any).leagueSettings.count({
      where: { leagueId: { in: leagueIds }, draftDateUtc: { gte: now, lte: windowEnd } },
    })
  }
  console.log(`draftsApproachingCount = ${draftsApproachingCount}`)

  console.log(`\n=== Step 4: composeDailyBrief (Today's Brief) ===`)
  const brief = composeDailyBrief({
    leaguesMonitored: leagues.length,
    healthyLeagueCount: snapshot.healthyLeagueCount,
    draftsApproachingCount,
    signals: snapshot.attentionQueue,
    leagueTrends: snapshot.leagueTrends,
  })
  console.log(JSON.stringify(brief, null, 2))

  console.log(`\n=== Step 5: composeNotificationFeed + resolveDeliveryPlan (Notification Center) ===`)
  const notifications = composeNotificationFeed({ signals: snapshot.attentionQueue, brief })
  const deliveryPlan = resolveDeliveryPlan(notifications)
  console.log(`Notifications: ${notifications.length}, in-app delivered: ${deliveryPlan.inApp.length}`)
  console.log(JSON.stringify(deliveryPlan.inApp, null, 2))

  console.log(`\n=== Step 6: Priority Modules — grouping snapshot.recommendations by real category ===`)
  const byCategory: Record<string, number> = {}
  for (const entry of snapshot.recommendations) {
    byCategory[entry.recommendation.category] = (byCategory[entry.recommendation.category] ?? 0) + 1
  }
  console.log(`Total recommendations: ${snapshot.recommendations.length}`)
  console.log(`By category: ${JSON.stringify(byCategory, null, 2)}`)

  console.log(`\n=== Consistency check: does atRiskLeagueCount agree with real medium/high/critical signals? ===`)
  const engagementRiskSignals = snapshot.attentionQueue.filter((s) => s.type === 'manager_engagement_risk')
  console.log(`atRiskLeagueCount=${snapshot.atRiskLeagueCount}, engagement-risk signals=${engagementRiskSignals.length}`)

  await prisma.$disconnect()
  console.log('\nDone.')
})().catch((err) => {
  console.error('VALIDATION SCRIPT ERROR:', err)
  process.exit(1)
})
