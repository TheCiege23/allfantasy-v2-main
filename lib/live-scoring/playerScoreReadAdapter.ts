/**
 * Live Scoring — canonical player-week score read adapter (G11 Phase 2b).
 *
 * Unifies the two stores the audit found:
 *  - `WeeklyScore`        — per-league *materialized* fantasy points (written by the
 *                           generic `weeklyProcessor`: handles all concepts, modes,
 *                           best-ball optimization, history, and stat corrections).
 *  - `PlayerWeeklyScore`  — global *raw stat lines* per player/week (the source of
 *                           truth every concept reads; redraft scores it on read via
 *                           `calculateScoreFromSportConfig`).
 *
 * This is a read-only adapter (no writes → idempotent, no migration risk, no
 * conflicting totals) with one explicit precedence rule. The math itself is never
 * duplicated here: materialized points are reused as-is, and raw stats are scored
 * by the *injected* concept scorer (`scoreFromStats`) so Redraft, Keeper, Dynasty,
 * Best Ball, Guillotine, Survivor, etc. each plug in their own authoritative scorer
 * behind the same shape. Pure and deterministic — DB loading lives in the caller.
 */

export type CanonicalScoreSource = 'materialized' | 'computed' | 'none'

export type CanonicalPlayerWeekScore = {
  playerId: string
  /** Fantasy points for this league/week (materialized or freshly computed). */
  points: number
  /** Stat line for the player row (raw stats, or the materialized statLine). */
  statLine: Record<string, unknown> | null
  /** Which store the value came from (telemetry/tests/precedence visibility). */
  source: CanonicalScoreSource
  /** True when the underlying game/score is final (no further change expected). */
  isFinalized: boolean
}

/** A precomputed per-league points row (from `WeeklyScore`). */
export type MaterializedScoreRow = {
  playerId: string
  points: number
  statLine: unknown
}

/** A raw stat-line row (from `PlayerWeeklyScore`). */
export type RawStatRow = {
  playerId: string
  stats: Record<string, number>
  isFinalized?: boolean
}

export type RequestedPlayer = {
  playerId: string
  position?: string | null
}

/**
 * Concept scorer: turns a raw stat line into fantasy points. Redraft injects
 * `calculateScoreFromSportConfig`; other concepts inject their own. Kept async so
 * a scorer may read league config.
 */
export type PlayerStatScorer = (input: {
  playerId: string
  stats: Record<string, number>
  position: string | null
}) => number | Promise<number>

function asStatRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Merge the two stores into one canonical per-player score map, deterministically.
 *
 * Precedence (the single rule when both exist):
 *  1. **materialized** `WeeklyScore` wins — it is the committed per-league result
 *     (carries stat corrections, best-ball optimization, and historical finals).
 *  2. else **computed** from the raw `PlayerWeeklyScore` stat line via the injected
 *     concept scorer (covers redraft, where only raw stats are persisted).
 *  3. else **none** (0 points, null line) — player has no data this week.
 *
 * Pure: callers pass already-loaded maps; no DB access here.
 */
export async function mergeCanonicalPlayerScores(input: {
  requestedPlayers: readonly RequestedPlayer[]
  materialized: ReadonlyMap<string, MaterializedScoreRow>
  rawStats: ReadonlyMap<string, RawStatRow>
  scoreFromStats: PlayerStatScorer
}): Promise<Map<string, CanonicalPlayerWeekScore>> {
  const out = new Map<string, CanonicalPlayerWeekScore>()

  for (const requested of input.requestedPlayers) {
    const playerId = requested.playerId
    if (out.has(playerId)) continue

    const mat = input.materialized.get(playerId)
    if (mat) {
      out.set(playerId, {
        playerId,
        points: round2(mat.points),
        statLine: asStatRecord(mat.statLine),
        source: 'materialized',
        isFinalized: true,
      })
      continue
    }

    const raw = input.rawStats.get(playerId)
    if (raw) {
      const points = await input.scoreFromStats({
        playerId,
        stats: raw.stats,
        position: requested.position ?? null,
      })
      out.set(playerId, {
        playerId,
        points: round2(Number.isFinite(points) ? points : 0),
        statLine: raw.stats,
        source: 'computed',
        isFinalized: raw.isFinalized ?? false,
      })
      continue
    }

    out.set(playerId, { playerId, points: 0, statLine: null, source: 'none', isFinalized: false })
  }

  return out
}
