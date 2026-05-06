/**
 * Rolling Insights soccer — schedule `status` and live `game_status` normalization.
 */

export type RollingInsightsSoccerNormalizedStatus =
  | 'scheduled'
  | 'delayed'
  | 'postponed'
  | 'suspended'
  | 'canceled'
  | 'inprogress'
  | 'final'
  | 'completed'
  | 'replaced'
  | 'halftime'
  | 'fulltime'
  | 'unknown'

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '')
}

/** Schedule row `status` — null-safe; preserves semantic for imports (do not drop raw). */
export function normalizeRollingInsightsSoccerStatus(status: unknown): RollingInsightsSoccerNormalizedStatus {
  if (status == null || status === '') return 'unknown'
  const n = norm(String(status))
  if (!n) return 'unknown'
  const map: Record<string, RollingInsightsSoccerNormalizedStatus> = {
    scheduled: 'scheduled',
    delayed: 'delayed',
    postponed: 'postponed',
    suspended: 'suspended',
    canceled: 'canceled',
    cancelled: 'canceled',
    inprogress: 'inprogress',
    final: 'final',
    completed: 'completed',
    replaced: 'replaced',
  }
  return map[n] ?? 'unknown'
}

export function isSoccerGameReplaced(status: unknown): boolean {
  return normalizeRollingInsightsSoccerStatus(status) === 'replaced'
}

/** Duplicate/incorrect schedule rows — exclude from live scoring expectations. */
export function shouldExpectSoccerLiveData(status: unknown): boolean {
  return !isSoccerGameReplaced(status)
}

/** Live feed `game_status` (Halftime, Fulltime, game_time, …). */
export function normalizeRollingInsightsSoccerGameStatus(gameStatus: unknown): string {
  if (gameStatus == null || gameStatus === '') return 'unknown'
  const s = String(gameStatus).trim()
  const low = s.toLowerCase()
  if (low.includes('half')) return 'halftime'
  if (low.includes('full')) return 'fulltime'
  return s
}
