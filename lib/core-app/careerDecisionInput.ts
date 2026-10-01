import 'server-only'

import { deriveCareerAttentionSignals } from '@/lib/decision-os/careerSignals'
import type { ManagerCommandCenterCareerInput } from '@/lib/decision-os/managerCommandCenter'
import { buildLegacyStakes, composeLegacyLine } from './careerMilestones'
import { NO_CAREER_FILTER } from './careerModel'
import { getCareerScreen } from './careerScreen'
import { getCareerWire } from './careerWire'
import type { WireLeagueInput } from './careerWireModel'
import { selectResyncCandidates } from './resyncableLeagues'
import { getPausedSyncKeys } from './syncPreferences'

/**
 * Live-career plan, phase 4 — the career layer the Manager Hub's Decision OS snapshot carries.
 *
 * Two reads the Career page already makes, and nothing new:
 *   - `getCareerScreen(…, 'overview')`, unfiltered — the stored career profile plus awards, which
 *     `buildLegacyStakes` turns into the same stakes and milestones the Career card shows.
 *   - `getCareerWire(…, recordVisit: false)` — per-league sync status. ⚠ `recordVisit` IS FALSE:
 *     the Manager Hub is not a Career visit, and moving the marker here would swallow the changes
 *     the Career screen is waiting to show.
 *
 * Fails closed to null: the command center is useful without its career layer, and a thrown read
 * here must never cost the snapshot.
 */
export async function loadCareerDecisionInput(args: {
  userId: string
  /** The dashboard league list rows the route already read (`getDashboardLeagueListForUser`). */
  leagueRows: readonly unknown[]
  now: Date
}): Promise<ManagerCommandCenterCareerInput | null> {
  const { userId, leagueRows, now } = args
  try {
    const leagues: WireLeagueInput[] = leagueRows
      .map((raw) => raw as Record<string, unknown>)
      .filter((r) => typeof r.id === 'string' && r.hasUnifiedRecord !== false)
      .map((r) => ({
        id: r.id as string,
        name: typeof r.name === 'string' ? r.name : null,
        platform: typeof r.platform === 'string' ? r.platform : null,
        platformLeagueId: typeof r.platformLeagueId === 'string' ? r.platformLeagueId : null,
        season: r.season != null && Number.isFinite(Number(r.season)) ? Number(r.season) : null,
        sport: typeof r.sport === 'string' ? r.sport : null,
        lastSyncedAt: (r.lastSyncedAt as Date | string | null | undefined) ?? null,
      }))

    const pausedKeys = await getPausedSyncKeys(userId).catch(() => new Set<string>())
    const pausedLeagueIds = new Set(
      selectResyncCandidates(leagueRows, pausedKeys)
        .filter((c) => pausedKeys.has(c.key))
        .map((c) => c.row.navigationLeagueId || c.row.id || '')
        .filter(Boolean),
    )

    const [screen, wire] = await Promise.all([
      getCareerScreen(userId, NO_CAREER_FILTER, 'overview'),
      getCareerWire({ userId, leagues, pausedLeagueIds, now, recordVisit: false }),
    ])
    const legacy = buildLegacyStakes(screen.data, screen.awards)

    return {
      signals: deriveCareerAttentionSignals({ wireLeagues: wire.leagues, stakes: legacy.stakes, now }),
      legacyLine: composeLegacyLine(legacy),
    }
  } catch (err) {
    console.error('[decision-os] career input read failed', err)
    return null
  }
}
