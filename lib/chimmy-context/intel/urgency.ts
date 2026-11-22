/**
 * Phase 2C Batch 4 Sub-batch D — Urgency scoring (first real pass).
 *
 * Promotes `level` + `score` from `"unknown"` / `null` to derived values.
 * All weights / thresholds live in `URGENCY_TUNABLES` so future tuning is
 * one edit. Formula stays intentionally simple and additive; sub-batch E+
 * may refine.
 *
 * Contract: NEVER throws; always returns a fully populated result.
 */

type UrgencyInput = {
  week: number | null
  playoffStartWeek: number | null
  weeksUntilPlayoffs: number | null
  isPlayoffWeek: boolean
  /** Matchup status reported by TeamWeekResult. */
  matchupStatus: "scheduled" | "in_progress" | "final" | "unknown"
  /** Whether the viewer is mathematically eliminated (future use). */
  isEliminated: boolean | null
  /** Whether the viewer has clinched a playoff seed (future use). */
  hasClinchedPlayoffs: boolean | null
  // ─── Phase 2C Batch 4 additions (all optional / nullable) ─────────────────
  /** Number of starters on bye this week. */
  byeWeekConflicts?: number | null
  /** Number of starters carrying an injury designation. */
  injuryFlagCount?: number | null
  /** Days remaining until the league trade deadline. */
  tradeDeadlineDaysLeft?: number | null
  /** Hours remaining until the next waiver process. */
  waiverDeadlineHoursLeft?: number | null
  /** 0-100 roster-weakness composite (future use). */
  rosterWeaknessScore?: number | null
}

type UrgencyLevel =
  | "critical"
  | "high"
  | "moderate"
  | "low"
  | "none"
  | "unknown"

export type UrgencyOutput = {
  level: UrgencyLevel
  /** Numeric 0-100 urgency score; `null` until formula lands. */
  score: number | null
  /** Short human-readable signal tags for prompt assembly. */
  signals: string[]
  inputs: UrgencyInput
}

/**
 * Placeholder implementation. Emits only safe, factual signals derived
 * directly from inputs (no fabricated weights). Replace internals (not
 * the signature) when finalized weights are approved.
 */
export const URGENCY_TUNABLES = {
  signalWeights: {
    playoff_week: 30,
    playoff_push: 20,
    in_progress: 5,
    eliminated: 5,
    clinched: -10,
    bye_conflict: 15,
    injury_pressure: 15,
    waiver_window_closing: 10,
    trade_window_closing: 10,
  } as Record<string, number>,
  /** Extra points per week-close-to-playoffs (0..4). */
  weeksUntilPlayoffsBonusByDistance: {
    0: 25,
    1: 18,
    2: 12,
    3: 6,
    4: 3,
  } as Record<number, number>,
  /** Score → level mapping (descending). */
  levelThresholds: {
    critical: 60,
    high: 40,
    moderate: 20,
    low: 5,
  } as const,
} as const

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

function mapScoreToLevel(score: number): UrgencyLevel {
  if (score >= URGENCY_TUNABLES.levelThresholds.critical) return "critical"
  if (score >= URGENCY_TUNABLES.levelThresholds.high) return "high"
  if (score >= URGENCY_TUNABLES.levelThresholds.moderate) return "moderate"
  if (score >= URGENCY_TUNABLES.levelThresholds.low) return "low"
  return "none"
}

export function computeUrgency(input: UrgencyInput): UrgencyOutput {
  const signals: string[] = []

  if (input.isPlayoffWeek) signals.push("playoff_week")
  if (
    !input.isPlayoffWeek &&
    input.weeksUntilPlayoffs != null &&
    input.weeksUntilPlayoffs <= 2 &&
    input.weeksUntilPlayoffs >= 1
  ) {
    signals.push("playoff_push")
  }
  if (input.matchupStatus === "in_progress") signals.push("in_progress")
  if (input.hasClinchedPlayoffs === true) signals.push("clinched")
  if (input.isEliminated === true) signals.push("eliminated")
  if ((input.byeWeekConflicts ?? 0) >= 2) signals.push("bye_conflict")
  if ((input.injuryFlagCount ?? 0) >= 2) signals.push("injury_pressure")
  if (
    input.waiverDeadlineHoursLeft != null &&
    input.waiverDeadlineHoursLeft >= 0 &&
    input.waiverDeadlineHoursLeft <= 12
  ) {
    signals.push("waiver_window_closing")
  }
  if (
    input.tradeDeadlineDaysLeft != null &&
    input.tradeDeadlineDaysLeft >= 0 &&
    input.tradeDeadlineDaysLeft <= 3
  ) {
    signals.push("trade_window_closing")
  }

  // ---- Scoring (first real pass) ----------------------------------------
  const hasAnyPlayoffData =
    input.isPlayoffWeek === true ||
    input.weeksUntilPlayoffs != null ||
    input.playoffStartWeek != null
  const hasSignalSource = signals.length > 0 || hasAnyPlayoffData
  if (!hasSignalSource) {
    return { level: "unknown", score: null, signals, inputs: input }
  }

  let raw = 0
  for (const sig of signals) {
    raw += URGENCY_TUNABLES.signalWeights[sig] ?? 0
  }
  if (
    !input.isPlayoffWeek &&
    input.weeksUntilPlayoffs != null &&
    input.weeksUntilPlayoffs >= 0
  ) {
    const bonus =
      URGENCY_TUNABLES.weeksUntilPlayoffsBonusByDistance[
        input.weeksUntilPlayoffs
      ] ?? 0
    raw += bonus
  }
  const score = clamp(raw, 0, 100)
  const level = mapScoreToLevel(score)

  return {
    level,
    score,
    signals,
    inputs: input,
  }
}
