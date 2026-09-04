/**
 * Fantasy OS — data-freshness contract (separate from the truth-label vocabulary).
 *
 * Freshness answers "how recent is the real data?" and NEVER changes the approved truth label. Stale REAL
 * data stays "Live League Data" with a truthful freshness of "delayed" — it is never relabeled as
 * "Presentation Preview". Thresholds are season-aware.
 */
import type { SeasonState } from './season'
import { cadenceForState, isInSeason } from './season'

export type SyncStatus = 'current' | 'refreshing' | 'delayed' | 'partial' | 'unavailable'
export type FreshnessSeverity = 'ok' | 'delayed' | 'critical'

export type FreshnessContract = {
  lastSuccessfulSyncAt: string | null
  lastAttemptedSyncAt: string | null
  nextScheduledSyncAt: string | null
  seasonState: SeasonState
  refreshCadenceMinutes: number
  syncStatus: SyncStatus
  /** Sub-level of staleness for delayed data (ok / delayed / critical). Does not change syncStatus. */
  severity: FreshnessSeverity
  sourceProvider: string
  sourceWindowStart: string
  sourceWindowEnd: string
}

/** Season-aware freshness thresholds (minutes). */
export function freshnessThresholds(seasonState: SeasonState): { currentMax: number; criticalMax: number } {
  return isInSeason(seasonState)
    ? { currentMax: 45, criticalMax: 90 } // in season
    : { currentMax: 300, criticalMax: 480 } // offseason: 5h current, 8h critical
}

export function ageMinutes(lastSuccessfulSyncAt: string | null, now: Date): number | null {
  if (!lastSuccessfulSyncAt) return null
  const t = new Date(lastSuccessfulSyncAt).getTime()
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / 60000
}

export function freshnessSeverity(seasonState: SeasonState, ageMin: number | null): FreshnessSeverity {
  if (ageMin == null) return 'critical'
  const { currentMax, criticalMax } = freshnessThresholds(seasonState)
  if (ageMin <= currentMax) return 'ok'
  if (ageMin <= criticalMax) return 'delayed'
  return 'critical'
}

/**
 * Compute syncStatus. Order of precedence: a run in progress → refreshing; a partial last run → partial;
 * no successful sync ever → unavailable; otherwise age vs the season-aware "current" threshold.
 * Stale-but-present data is `delayed`, never hidden or relabeled.
 */
export function computeSyncStatus(input: {
  seasonState: SeasonState
  lastSuccessfulSyncAt: string | null
  now: Date
  refreshing?: boolean
  partial?: boolean
}): SyncStatus {
  if (input.refreshing) return 'refreshing'
  if (input.partial) return 'partial'
  const age = ageMinutes(input.lastSuccessfulSyncAt, input.now)
  if (age == null) return 'unavailable'
  const { currentMax } = freshnessThresholds(input.seasonState)
  return age <= currentMax ? 'current' : 'delayed'
}

export function nextScheduledSyncAt(seasonState: SeasonState, fromIso: string | null, now: Date): string {
  const base = fromIso ? new Date(fromIso).getTime() : now.getTime()
  const cadenceMs = cadenceForState(seasonState) * 60000
  const anchor = Number.isNaN(base) ? now.getTime() : base
  return new Date(anchor + cadenceMs).toISOString()
}

export function buildFreshness(input: {
  seasonState: SeasonState
  lastSuccessfulSyncAt: string | null
  lastAttemptedSyncAt: string | null
  now: Date
  refreshing?: boolean
  partial?: boolean
  sourceProvider: string
  sourceWindowStart: string
  sourceWindowEnd: string
}): FreshnessContract {
  const syncStatus = computeSyncStatus(input)
  const age = ageMinutes(input.lastSuccessfulSyncAt, input.now)
  return {
    lastSuccessfulSyncAt: input.lastSuccessfulSyncAt,
    lastAttemptedSyncAt: input.lastAttemptedSyncAt,
    nextScheduledSyncAt: nextScheduledSyncAt(input.seasonState, input.lastAttemptedSyncAt ?? input.lastSuccessfulSyncAt, input.now),
    seasonState: input.seasonState,
    refreshCadenceMinutes: cadenceForState(input.seasonState),
    syncStatus,
    severity: freshnessSeverity(input.seasonState, age),
    sourceProvider: input.sourceProvider,
    sourceWindowStart: input.sourceWindowStart,
    sourceWindowEnd: input.sourceWindowEnd,
  }
}

/**
 * Deterministic "is a refresh due?" decision for the season-aware scheduler heartbeat. A frequent cron
 * (e.g. every 30 min) calls this; it only actually syncs when the elapsed time since the last completed run
 * meets the season cadence — so one fixed cron schedule yields season-aware behavior (30m in season, 4h off).
 */
export function isSyncDue(lastFinishedAtIso: string | null, cadenceMinutes: number, now: Date): boolean {
  if (!lastFinishedAtIso) return true
  const t = new Date(lastFinishedAtIso).getTime()
  if (Number.isNaN(t)) return true
  return now.getTime() - t >= cadenceMinutes * 60000
}

/** Human summary for the UI, e.g. "Delayed · last update 2h ago". Never claims currency it doesn't have. */
export function freshnessLabel(f: FreshnessContract, now: Date): string {
  const age = ageMinutes(f.lastSuccessfulSyncAt, now)
  const ago =
    age == null
      ? 'never'
      : age < 60
        ? `${Math.round(age)}m ago`
        : age < 1440
          ? `${Math.round(age / 60)}h ago`
          : `${Math.round(age / 1440)}d ago`
  const status = f.syncStatus.charAt(0).toUpperCase() + f.syncStatus.slice(1)
  return `${status} · last update ${ago}`
}
