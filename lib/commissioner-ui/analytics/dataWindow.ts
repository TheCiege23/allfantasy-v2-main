import { prisma } from '@/lib/prisma'
import { lookbackDays } from '@/lib/decision-os/behavioral/api/real-data-provider'
import { MANAGER_INACTIVE_AFTER_DAYS } from '@/lib/decision-os/behavioral/manager-intelligence'
import type { AnalyticsDataWindow } from './decision-os-client/types'

/**
 * Reads the provenance behind Commissioner OS's window-derived KPIs — how fresh the underlying
 * data is, and what the league looks like OUTSIDE the window.
 *
 * DB-first by construction: this only ever reads Postgres. It is a presentation concern (how
 * should this page caveat its own numbers), not a Decision OS capability, which is why it lives
 * in `commissioner-ui` rather than being threaded through the Intelligence API contract. Both
 * thresholds are IMPORTED rather than restated — `lookbackDays()` and
 * `MANAGER_INACTIVE_AFTER_DAYS` each keep a single definition, so a tuned window can never
 * disagree with the sentence describing it.
 *
 * ⚠ The league resolution here must stay identical to `defaultLoadImportedActivityRows`'s. If
 * this counted only `afLeagueId` while the pipeline also matches `providerLeagueId`, the banner
 * would report "no data" over KPIs computed from real events — the page would then be wrong in
 * a new way rather than honest about being stale.
 */
export async function readAnalyticsDataWindow(leagueId: string): Promise<AnalyticsDataWindow | null> {
  try {
    const delegate = (prisma as unknown as { decisionOsImportedActivity?: unknown })
      ?.decisionOsImportedActivity
    if (!delegate) return null

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { platform: true, platformLeagueId: true },
    })

    const where =
      league?.platform && league.platformLeagueId
        ? {
            OR: [
              { afLeagueId: leagueId },
              { providerLeagueId: leagueId },
              { provider: league.platform, providerLeagueId: league.platformLeagueId },
            ],
          }
        : { OR: [{ afLeagueId: leagueId }, { providerLeagueId: leagueId }] }

    const [newest, byType] = await Promise.all([
      prisma.decisionOsImportedActivity.aggregate({ where, _max: { occurredAt: true } }),
      prisma.decisionOsImportedActivity.groupBy({
        by: ['activityType'],
        where,
        _count: { _all: true },
      }),
    ])

    const counts = new Map<string, number>(
      byType.map((row) => [row.activityType, row._count._all]),
    )
    const eventCount = byType.reduce((sum, row) => sum + row._count._all, 0)

    /*
     * A league with genuinely zero imported activity is a different thing from a league whose
     * activity is merely old, and the caller must be able to tell them apart. Returning null
     * here would collapse both into "window unknown", so the row is returned with a null
     * `lastActivityAt` and honest zero counts instead.
     */
    const lastActivityAt = newest._max.occurredAt ?? null

    return {
      lookbackDays: lookbackDays(),
      inactiveAfterDays: MANAGER_INACTIVE_AFTER_DAYS,
      lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
      daysSinceLastActivity: lastActivityAt
        ? Math.floor((Date.now() - lastActivityAt.getTime()) / 86_400_000)
        : null,
      allTime: {
        // Sleeper's importer types a trade as `trade` and a waiver claim as `waiver`; the
        // remaining types (`roster_move`, `draft_pick`) are counted only into `eventCount`.
        tradeCount: counts.get('trade') ?? 0,
        waiverCount: counts.get('waiver') ?? 0,
        eventCount,
      },
    }
  } catch {
    // Never let provenance break the page it is annotating — a missing window renders exactly
    // as this page did before the window existed.
    return null
  }
}
