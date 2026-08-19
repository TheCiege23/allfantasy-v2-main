/**
 * Fantasy OS Suite — Phase OS-B3: Daily Brief Composition Engine.
 *
 * The standalone, fully self-contained resolver for `composeDailyBrief` (`dailyBrief.ts`) — for any
 * future consumer that does NOT already have a fetched `CommissionerCommandCenterSnapshot` to compose
 * from (an email digest cron, a Notification Engine job, a mobile client, a Platform OS summary).
 * Mirrors `attentionQueue.ts`'s own "standalone resolver, explicit tradeoff" precedent from OS-B2.
 *
 * Documented tradeoff, same shape as OS-B2's: this resolver calls the ALREADY-standalone
 * `resolveAttentionQueueSnapshot` for signals (reuse, never re-derives them), then does its OWN
 * separate per-league `resolveMissionControlSnapshot` fetch for `healthyLeagueCount` and league
 * trends — meaning Mission Control gets fetched TWICE per league within this resolver's own execution.
 * This is accepted here (unlike inside `commissionerCommandCenter.ts`, which deliberately avoids it)
 * because `resolveDailyBrief` is meant for callers with NO existing page-load context to reuse data
 * from (a background job, not a page render) — the double-fetch cost is real but isolated to this
 * resolver's own standalone invocation, not stacked on top of an already-fetched page. The Commissioner
 * Hub's own "Today's Brief" card does NOT call this resolver — it composes directly from data
 * `CommissionerCommandCenterSection.tsx` already fetched, with zero additional requests. See
 * `docs/os/DAILY_BRIEF.md` §4.
 *
 * `draftsApproachingCount` is deliberately NOT a new query here — it's derived by counting
 * `draft_approaching` signals already present in `resolveAttentionQueueSnapshot`'s own output, which
 * already applies the real 14-day window (`attentionSignals.ts`'s own single source of truth for that
 * window). Adding a second, separate draft-date query here would risk the two counts silently drifting
 * apart.
 */
import { resolveMissionControlSnapshot } from './missionControl'
import { resolveAttentionQueueSnapshot } from './attentionQueue'
import { composeDailyBrief, type DailyBrief, type DailyBriefLeagueTrend } from './dailyBrief'

const HEALTHY_STATUSES = new Set(['excellent', 'healthy'])

/**
 * Resolves the Daily Brief for an EXPLICIT set of league IDs — the same "explicit-list only, caller
 * resolves authorization" contract every sibling Decision OS composition already follows. Never
 * throws — a failure resolving any one league's Mission Control data simply excludes it from the
 * healthy count / league highlights, never breaks the whole brief.
 */
export async function resolveDailyBrief(
  leagueIds: readonly string[],
  now: Date = new Date(),
): Promise<DailyBrief> {
  if (leagueIds.length === 0) {
    return composeDailyBrief(
      { leaguesMonitored: 0, healthyLeagueCount: 0, draftsApproachingCount: 0, signals: [], leagueTrends: [] },
      now,
    )
  }

  const [attentionSnapshot, perLeagueSnapshots] = await Promise.all([
    resolveAttentionQueueSnapshot(leagueIds, now),
    Promise.all(leagueIds.map((leagueId) => resolveMissionControlSnapshot(leagueId, now).catch(() => null))),
  ])

  let healthyLeagueCount = 0
  const leagueTrends: DailyBriefLeagueTrend[] = []
  for (const snapshot of perLeagueSnapshots) {
    if (!snapshot) continue
    if (snapshot.leagueHealth.available && HEALTHY_STATUSES.has(snapshot.leagueHealth.result.engine.overallStatus)) {
      healthyLeagueCount += 1
    }
    if (snapshot.trend.available) {
      leagueTrends.push({
        leagueId: snapshot.leagueId,
        direction: snapshot.trend.direction,
        eventCountDelta: snapshot.trend.eventCountDelta,
      })
    }
  }

  const draftsApproachingCount = attentionSnapshot.signals.filter((s) => s.type === 'draft_approaching').length

  return composeDailyBrief(
    {
      leaguesMonitored: leagueIds.length,
      healthyLeagueCount,
      draftsApproachingCount,
      signals: attentionSnapshot.signals,
      leagueTrends,
    },
    now,
  )
}
