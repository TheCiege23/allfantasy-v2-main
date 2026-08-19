/**
 * Fantasy OS Suite — Phase OS-B2: Decision OS Attention Queue.
 *
 * The standalone, fully self-contained Decision OS composition for `deriveLeagueAttentionSignals`
 * (`attentionSignals.ts`) — resolves its OWN Mission Control snapshot, League Context, and draft-date
 * inputs per league, so any future consumer that does NOT already have those resolved (a Notification
 * Engine job, a Daily Brief cron, Platform OS, a mobile client) can call
 * `resolveAttentionQueueSnapshot` directly without duplicating this composition's fetch/derive/sort
 * logic.
 *
 * Explicit, documented tradeoff: `commissionerCommandCenter.ts` (Commissioner OS's OS-B1 composition)
 * deliberately does NOT call this resolver. It already fetches a `MissionControlSnapshot` per league
 * for its own league-summary/ranking output — calling this resolver too would fetch Mission Control
 * TWICE per league on the same Commissioner Hub page load, exactly the double-fetch this whole Decision
 * OS suite's "sibling, not wrapper" discipline exists to avoid (see `commissionerCommandCenter.ts`'s
 * own header comment). Instead, `commissionerCommandCenter.ts` calls the pure `deriveLeagueAttentionSignals`
 * directly, reusing the `MissionControlSnapshot` it already has in hand, and shares only the small
 * `loadUpcomingDraftDates` batched lookup below (not a duplicate of anything expensive). This module
 * exists for every OTHER consumer that doesn't already have Mission Control resident.
 */
import { prisma as defaultPrisma } from '@/lib/prisma'
import { resolveMissionControlSnapshot } from './missionControl'
import { resolveLeagueFinancialContextSafely } from './leagueContext'
import {
  ATTENTION_QUEUE_CAP,
  deriveLeagueAttentionSignals,
  sortAttentionSignals,
  type DecisionOsAttentionSignal,
} from './attentionSignals'

export interface AttentionQueueSnapshot {
  generatedAt: string
  signals: DecisionOsAttentionSignal[]
  warnings: string[]
}

/**
 * Batched lookup of real, persisted draft dates for AF-native leagues (`LeagueSettings.draftDateUtc`).
 * Deliberately unfiltered by date range — `deriveLeagueAttentionSignals` owns the "what counts as
 * approaching" window, so this stays a plain, reusable "what draft dates exist" lookup shared by both
 * this resolver and `commissionerCommandCenter.ts`. Honest degradation to an empty map on any failure
 * or for a league with no `LeagueSettings` row (Sleeper-imported leagues have none) — never a crash for
 * a signal that's explicitly best-effort.
 */
export async function loadUpcomingDraftDates(
  leagueIds: readonly string[],
  prisma: { leagueSettings: { findMany(args: unknown): Promise<{ leagueId: string; draftDateUtc: Date | null }[]> } } = defaultPrisma as never,
): Promise<Map<string, Date>> {
  if (leagueIds.length === 0) return new Map()
  try {
    const rows = await prisma.leagueSettings.findMany({
      where: { leagueId: { in: [...leagueIds] }, draftDateUtc: { not: null } },
      select: { leagueId: true, draftDateUtc: true },
    })
    const map = new Map<string, Date>()
    for (const row of rows) {
      if (row.draftDateUtc) map.set(row.leagueId, row.draftDateUtc)
    }
    return map
  } catch {
    return new Map()
  }
}

/**
 * Resolves the full, cross-league, priority-sorted Attention Queue for an EXPLICIT set of league IDs —
 * the same "explicit-list only, caller resolves authorization" contract every sibling Decision OS
 * composition already follows (`commissionerCommandCenter.ts`, `platformOs.ts`). Never throws — a
 * failure resolving any one league's Mission Control or League Context data simply yields no signals
 * for that league, never a broken response for the whole queue.
 */
export async function resolveAttentionQueueSnapshot(
  leagueIds: readonly string[],
  now: Date = new Date(),
): Promise<AttentionQueueSnapshot> {
  if (leagueIds.length === 0) {
    return { generatedAt: now.toISOString(), signals: [], warnings: ['no_leagues_specified'] }
  }

  const draftDates = await loadUpcomingDraftDates(leagueIds)
  const all: DecisionOsAttentionSignal[] = []

  for (const leagueId of leagueIds) {
    const [missionControl, financialContext] = await Promise.all([
      resolveMissionControlSnapshot(leagueId, now).catch(() => null),
      resolveLeagueFinancialContextSafely(leagueId).catch(() => null),
    ])

    let overallStatus: string | null = null
    let leagueHealthScore: number | null = null
    if (missionControl && missionControl.leagueHealth.available) {
      const engine = missionControl.leagueHealth.result.engine
      overallStatus = engine.overallStatus
      leagueHealthScore = typeof engine.leagueHealthScore === 'number' ? engine.leagueHealthScore : null
    }

    all.push(
      ...deriveLeagueAttentionSignals({
        leagueId,
        now,
        overallStatus,
        leagueHealthScore,
        recommendedActions: missionControl?.recommendedActions ?? [],
        financialStatus: financialContext?.financialStatus ?? 'UNKNOWN',
        draftDateUtc: draftDates.get(leagueId) ?? null,
      }),
    )
  }

  return {
    generatedAt: now.toISOString(),
    signals: sortAttentionSignals(all).slice(0, ATTENTION_QUEUE_CAP),
    warnings: [],
  }
}
