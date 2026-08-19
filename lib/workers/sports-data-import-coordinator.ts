import 'server-only'

import { randomUUID } from 'node:crypto'
import { runSportsDataImporter } from '@/lib/workers/sports-data-importer'
import { runNewsImporter } from '@/lib/workers/news-importer'

// Phase 21: process-local single-flight guard + cooldown around runSportsDataImporter,
// used by getPlayer()/searchPlayers() miss-paths so a genuine cache miss no longer forces
// the initiating customer request to await a full per-sport import (measured 90-190s in
// Phase 19/20). This guard is process-local only -- it does not coordinate across
// multiple server instances/regions. A concurrent miss on a different instance can still
// start its own import; this only prevents duplicate fan-out *within one process* (the
// dominant real risk found in Phase 20: up to 6 parallel searchPlayers() calls from a
// single unified-orchestration request).

// Phase 23: generated once when this module is first evaluated. Two log lines with the
// same coordinatorInstanceId came from the same module instance (state genuinely shared);
// two different IDs prove separate instances (state NOT shared), regardless of route or
// process. This is the direct, empirical way to answer "does route A share coordinator
// state with route B" instead of inferring it from timing alone, as Phase 22 had to.
const COORDINATOR_INSTANCE_ID = randomUUID()
const COORDINATOR_INSTANCE_STARTED_AT = new Date().toISOString()

const inFlightImports = new Map<string, Promise<void>>()
const lastAttemptAt = new Map<string, number>()

// Cooldown rationale: measured worst-case single-sport import latency was 89.8s-189.2s
// (Phase 19/20 real measurements). 5 minutes comfortably exceeds the worst observed run so
// a failed or slow attempt has time to fully resolve before a new one is allowed, while
// remaining far shorter than the 6-hour player-data TTL, so a genuinely new/mistyped
// lookup becomes retryable again well within the same user session.
export const REFRESH_COOLDOWN_MS = 5 * 60 * 1000

export type PlayerRefreshTriggerSource =
  | 'get_player_miss'
  | 'search_players_miss'
  | 'get_players_by_team_miss'

function logRefreshEvent(event: string, details: Record<string, unknown>): void {
  console.log(
    '[sports-data-import-coordinator]',
    JSON.stringify({
      event,
      ...details,
      coordinatorInstanceId: COORDINATOR_INSTANCE_ID,
      pid: typeof process !== 'undefined' ? process.pid : undefined,
      at: new Date().toISOString(),
    })
  )
}

/** Exposed for Phase 23 runtime-scope verification: proves whether two call sites share this module instance. */
export function getCoordinatorInstanceInfo(): { coordinatorInstanceId: string; startedAt: string; pid: number | undefined } {
  return {
    coordinatorInstanceId: COORDINATOR_INSTANCE_ID,
    startedAt: COORDINATOR_INSTANCE_STARTED_AT,
    pid: typeof process !== 'undefined' ? process.pid : undefined,
  }
}

/**
 * Fire-and-forget request to refresh a sport's player data. Never throws, never blocks
 * the caller. At most one import per sport is in flight per process; concurrent callers
 * for the same sport observe (join) the same in-flight promise instead of starting a new
 * import. A recently-completed attempt (success or failure) suppresses new attempts for
 * REFRESH_COOLDOWN_MS to avoid retry-storming a sport that just failed or is still slow.
 */
export function requestPlayerImportRefresh(sport: string, triggerSource: PlayerRefreshTriggerSource): void {
  const existing = inFlightImports.get(sport)
  if (existing) {
    logRefreshEvent('refresh_joined', { sport, triggerSource })
    return
  }

  const lastAttempt = lastAttemptAt.get(sport)
  if (lastAttempt !== undefined && Date.now() - lastAttempt < REFRESH_COOLDOWN_MS) {
    logRefreshEvent('refresh_suppressed_cooldown', {
      sport,
      triggerSource,
      msSinceLastAttempt: Date.now() - lastAttempt,
    })
    return
  }

  const startedAt = Date.now()
  lastAttemptAt.set(sport, startedAt)
  logRefreshEvent('refresh_started', { sport, triggerSource })

  const task = runSportsDataImporter({ sports: [sport] })
    .then((result) => {
      logRefreshEvent('refresh_completed', {
        sport,
        triggerSource,
        durationMs: Date.now() - startedAt,
        imported: result.imported,
      })
    })
    .catch((error) => {
      logRefreshEvent('refresh_failed', {
        sport,
        triggerSource,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      inFlightImports.delete(sport)
    })

  inFlightImports.set(sport, task)
}

// Phase 22: getPlayerNews() misses call runNewsImporter(), a genuinely separate importer
// from runSportsDataImporter() (different provider calls, different cost profile, and --
// unlike the sport-scoped player-data path -- no per-sport argument is available at the
// getPlayerNews() call site, since a playerId lookup doesn't carry a known sport). This
// state is intentionally kept separate from inFlightImports/lastAttemptAt above so a
// player-data sport code can never collide with the news dedup key, even though both live
// in this one module (per Phase 22 scope: reuse the coordinator, don't build a second one).

const newsInFlightRefresh = new Map<string, Promise<void>>()
const newsLastAttemptAt = new Map<string, number>()
const NEWS_REFRESH_KEY = 'all-sports-news'

// Cooldown rationale: runNewsImporter() is structurally cheaper per sport than
// runSportsDataImporter() (one external provider fetch instead of three, no chunked
// upsert loop) but still loops every supported sport and still funnels through the same
// unbounded, no-timeout apiChain provider fallback chain Phase 20 audited. Reusing the
// same 5-minute cooldown as the player-data path until a materially different real
// latency profile is measured (see the Phase 22 soak results) -- not shortened without
// evidence, per this phase's explicit instruction.
export const NEWS_REFRESH_COOLDOWN_MS = REFRESH_COOLDOWN_MS

export type PlayerNewsRefreshTriggerSource = 'get_player_news_miss'

/**
 * Fire-and-forget request to refresh player news across all sports (matching the exact
 * scope runNewsImporter() already runs with no arguments, preserving pre-Phase-22
 * semantics). Same single-flight + cooldown contract as requestPlayerImportRefresh, kept
 * as its own function because the underlying importer and its natural dedup key differ.
 */
export function requestPlayerNewsRefresh(triggerSource: PlayerNewsRefreshTriggerSource): void {
  const existing = newsInFlightRefresh.get(NEWS_REFRESH_KEY)
  if (existing) {
    logRefreshEvent('refresh_joined', { sport: 'ALL', triggerSource })
    return
  }

  const lastAttempt = newsLastAttemptAt.get(NEWS_REFRESH_KEY)
  if (lastAttempt !== undefined && Date.now() - lastAttempt < NEWS_REFRESH_COOLDOWN_MS) {
    logRefreshEvent('refresh_suppressed_cooldown', {
      sport: 'ALL',
      triggerSource,
      msSinceLastAttempt: Date.now() - lastAttempt,
    })
    return
  }

  const startedAt = Date.now()
  newsLastAttemptAt.set(NEWS_REFRESH_KEY, startedAt)
  logRefreshEvent('refresh_started', { sport: 'ALL', triggerSource })

  const task = runNewsImporter()
    .then((result) => {
      logRefreshEvent('refresh_completed', {
        sport: 'ALL',
        triggerSource,
        durationMs: Date.now() - startedAt,
        imported: result.imported,
      })
    })
    .catch((error) => {
      logRefreshEvent('refresh_failed', {
        sport: 'ALL',
        triggerSource,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      newsInFlightRefresh.delete(NEWS_REFRESH_KEY)
    })

  newsInFlightRefresh.set(NEWS_REFRESH_KEY, task)
}

// Phase 24: lib/data/news.ts's getLatestNews()/getHighImpactNews() call
// runNewsImporter({sports:[sport]}) -- sport-scoped, unlike getPlayerNews()'s all-sports
// call above. Reuses the exact same newsInFlightRefresh/newsLastAttemptAt Maps (keyed by
// the real sport string instead of the fixed NEWS_REFRESH_KEY constant) rather than
// building new state -- the two key spaces never collide since no real sport code equals
// 'all-sports-news'. Same cooldown, same flag, same telemetry shape, identical pattern to
// requestPlayerImportRefresh/requestPlayerNewsRefresh above, per this phase's explicit
// "no second coordinator, identical architectural pattern" requirement.

export type SportNewsRefreshTriggerSource = 'get_latest_news_miss' | 'get_high_impact_news_miss'

/**
 * Fire-and-forget request to refresh one sport's news (matching runNewsImporter({sports:[sport]})'s
 * existing scope). Same single-flight + cooldown contract as the other coordinator functions.
 */
export function requestSportNewsRefresh(sport: string, triggerSource: SportNewsRefreshTriggerSource): void {
  const existing = newsInFlightRefresh.get(sport)
  if (existing) {
    logRefreshEvent('refresh_joined', { sport, triggerSource })
    return
  }

  const lastAttempt = newsLastAttemptAt.get(sport)
  if (lastAttempt !== undefined && Date.now() - lastAttempt < NEWS_REFRESH_COOLDOWN_MS) {
    logRefreshEvent('refresh_suppressed_cooldown', {
      sport,
      triggerSource,
      msSinceLastAttempt: Date.now() - lastAttempt,
    })
    return
  }

  const startedAt = Date.now()
  newsLastAttemptAt.set(sport, startedAt)
  logRefreshEvent('refresh_started', { sport, triggerSource })

  const task = runNewsImporter({ sports: [sport] })
    .then((result) => {
      logRefreshEvent('refresh_completed', {
        sport,
        triggerSource,
        durationMs: Date.now() - startedAt,
        imported: result.imported,
      })
    })
    .catch((error) => {
      logRefreshEvent('refresh_failed', {
        sport,
        triggerSource,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    .finally(() => {
      newsInFlightRefresh.delete(sport)
    })

  newsInFlightRefresh.set(sport, task)
}

/** Test-only: clears in-memory coordinator state between test cases. */
export function __resetPlayerImportCoordinatorForTests(): void {
  inFlightImports.clear()
  lastAttemptAt.clear()
  newsInFlightRefresh.clear()
  newsLastAttemptAt.clear()
}
