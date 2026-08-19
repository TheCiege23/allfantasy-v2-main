/**
 * Fantasy OS Suite — Phase D Increment 6.
 *
 * READ-ONLY conformance check for the three built OS surfaces (Commissioner OS, User OS, Platform
 * OS) against a REAL non-prod database, for an EXPLICIT set of leagues — no auto-discovery, by
 * design, unlike the sibling `decision-os-world-conformance.ts`. Mirrors that script's exact safety
 * contract: skips cleanly without a DATABASE_URL, hard-refuses the production host, never writes.
 *
 * This does NOT seed any data. Run it against a league already imported via the existing
 * `scripts/decision-os-import-sleeper-nonprod.ts` (or any other real, already-imported league) to
 * verify all three OS compositions resolve correctly against it.
 *
 *   DATABASE_URL=<non-prod db> npx tsx scripts/decision-os-suite-conformance.ts \
 *     --leagueIds=<leagueId1>,<leagueId2> [--managerId=<userId>]
 *
 * `--leagueIds` is REQUIRED and explicit (comma-separated AF league ids). `--managerId` is
 * optional — when supplied, also checks User OS for that manager in the FIRST supplied league.
 * Without a DATABASE_URL, or with an empty `--leagueIds`, this skips/refuses cleanly rather than
 * guessing at which leagues to check.
 *
 * See docs/os/SLEEPER_OS_SUITE_PROOF_CHECKLIST.md for the full end-to-end proof procedure this
 * script is one step of (import a real league → run this → verify Commissioner OS/User OS in a
 * browser → note the one still-open ingestion gap for real activity-derived signals).
 */
import { hasDatabaseUrl, resolveDatabaseUrl } from '../lib/env/database-url'
import {
  hostOf,
  isProductionHost,
  parseExplicitLeagueIds,
  parseManagerId,
  formatCheckLine,
  type ConformanceCheckResult,
} from './decision-os-suite-conformance-helpers'

const results: ConformanceCheckResult[] = []
function check(name: string, ok: boolean, detail = ''): void {
  const result: ConformanceCheckResult = { name, ok, detail }
  results.push(result)
  console.log(formatCheckLine(result))
}

;(async () => {
  if (!hasDatabaseUrl()) {
    console.log('SUITE_CONFORMANCE SKIPPED (no DATABASE_URL) — set a non-prod DATABASE_URL to run this check.')
    process.exit(0)
  }
  const dbUrl = resolveDatabaseUrl()
  const host = hostOf(dbUrl)
  if (isProductionHost(dbUrl)) {
    console.error(`REFUSED: resolved DB host (${host}) is the PRODUCTION host. This is a read-only, non-prod-only check.`)
    process.exit(1)
  }

  const leagueIds = parseExplicitLeagueIds(process.argv.slice(2))
  if (leagueIds.length === 0) {
    console.error('REFUSED: no --leagueIds= supplied. This script never auto-discovers leagues — pass explicit ids.')
    process.exit(1)
  }
  const managerId = parseManagerId(process.argv.slice(2))

  console.log(`Fantasy OS Suite conformance — READ-ONLY — DB host: ${host}`)
  console.log(`leagueIds=${leagueIds.join(',')}${managerId ? ` managerId=${managerId}` : ' (no --managerId, skipping User OS)'}`)

  const { resolveMissionControlSnapshot } = await import('../lib/decision-os/missionControl')
  const { resolveLeagueAnalyticsSnapshot } = await import('../lib/decision-os/leagueAnalytics')
  const { resolvePlatformOsSnapshot } = await import('../lib/decision-os/platformOs')
  const { resolveUserOsSnapshot } = await import('../lib/decision-os/userOs')
  const { prisma } = await import('../lib/prisma')

  try {
    // ── Commissioner OS: Mission Control + League Analytics, per league ─────────────────────────
    for (const leagueId of leagueIds) {
      const mc = await resolveMissionControlSnapshot(leagueId)
      check(
        `Mission Control resolves for ${leagueId}`,
        mc.leagueHealth.available,
        mc.leagueHealth.available
          ? `status=${mc.leagueHealth.result.engine.overallStatus} activeManagers=${mc.managerCounts.activeManagers} trades=${mc.activity.tradeCount} waivers=${mc.activity.waiverClaimCount}`
          : 'league_health_unavailable',
      )

      const la = await resolveLeagueAnalyticsSnapshot(leagueId)
      check(
        `League Analytics resolves for ${leagueId}`,
        la.available,
        la.available ? `retentionRiskCount=${la.retentionRiskCount} trend=${la.trend.available ? la.trend.direction : la.trend.reason}` : 'unavailable',
      )
    }

    // ── User OS: one manager, in the first supplied league (only when --managerId given) ────────
    if (managerId) {
      const userOs = await resolveUserOsSnapshot(leagueIds[0], managerId)
      check(
        `User OS resolves for manager ${managerId} in ${leagueIds[0]}`,
        userOs.available,
        userOs.available
          ? `tier=${userOs.teamHealth.participationTier} score=${userOs.teamHealth.overallEngagementScore} trades=${userOs.activitySummary.tradeEventCount}`
          : 'user_os_unavailable',
      )
    }

    // ── Platform OS: aggregate across ALL supplied leagues (explicit list, no discovery) ─────────
    const platformOs = await resolvePlatformOsSnapshot(leagueIds)
    check(
      `Platform OS aggregates ${leagueIds.length} explicit league(s)`,
      platformOs.totalMonitoredLeagues === leagueIds.length,
      `healthy=${platformOs.healthyLeagueCount} atRisk=${platformOs.atRiskLeagueCount} unavailable=${platformOs.unavailableLeagueCount} attentionQueue=${platformOs.attentionQueue.length}`,
    )

    const failures = results.filter((r) => !r.ok).length
    console.log(`SUITE_CONFORMANCE_RESULT: ${results.length - failures}/${results.length} checks passed.`)
    if (failures > 0) {
      console.log(
        'A failing check here is not necessarily a bug — it commonly means the league has no captured ' +
          'activity yet (see docs/os/SLEEPER_OS_SUITE_PROOF_CHECKLIST.md for the known ingestion gap).',
      )
    }

    await prisma.$disconnect().catch(() => undefined)
    process.exit(failures > 0 ? 1 : 0)
  } catch (e) {
    await prisma.$disconnect().catch(() => undefined)
    console.error('SUITE_CONFORMANCE_FAILED (exception)', e instanceof Error ? e.stack : e)
    process.exit(1)
  }
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.stack : e)
  process.exit(1)
})
