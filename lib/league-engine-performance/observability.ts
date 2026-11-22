/**
 * Structured logging and timing for league-engine operations (cron, workers, API hot paths).
 * Logs are JSON lines for log aggregators; avoid PII in `extra`.
 */

export type LeagueEngineSubsystem =
  | 'waiver'
  | 'scoring'
  | 'draft'
  | 'trade'
  | 'roster'
  | 'automation'
  | 'import'
  | 'notification'
  | 'cron'
  | 'queue'
  | 'matchup'
  | 'api'

type LeagueEngineLogEvent = {
  subsystem: LeagueEngineSubsystem
  action: string
  leagueId?: string
  durationMs?: number
  idempotencyKey?: string
  jobId?: string
  ok?: boolean
  error?: string
  extra?: Record<string, unknown>
}

export function logLeagueEngineEvent(event: LeagueEngineLogEvent): void {
  const payload = {
    ts: new Date().toISOString(),
    source: 'league_engine',
    ...event,
  }
  const line = JSON.stringify(payload)
  if (event.ok === false || event.error) {
    console.error(line)
  } else {
    console.log(line)
  }
}

export function createEngineTimer(): { elapsedMs: () => number } {
  const start = process.hrtime.bigint()
  return {
    elapsedMs: () => Number(process.hrtime.bigint() - start) / 1_000_000,
  }
}

/** Default slow-path threshold for API routes (matchup build, import preview, etc.). */
export const DEFAULT_SLOW_ROUTE_MS = 2500

