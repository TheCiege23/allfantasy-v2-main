/**
 * Commissioner score adjustments (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1, Free): a manual point
 * adjustment to one team's score in one matchup, with a required reason — a stat-correction dispute,
 * a lineup-violation penalty, a ruling.
 *
 * ⚠ AN ADJUSTMENT IS STORED BESIDE THE SCORE, NEVER INSTEAD OF IT. `RedraftMatchup.homeScore` is
 * rewritten by every rescore from player stats, so an adjustment written into it alone would vanish
 * on the next score sync. The list lives in `League.settings.commissioner_score_adjustments`, which
 * the scoring engine reads on every rescore and adds on top of the computed points — so the stored
 * score, and everything that reads it (standings, matchup pages, recaps, playoffs), always includes it.
 *
 * ⚠ AND NOT IN `RedraftMatchup.lineupSnapshots`, which looks like the natural home. The scorer
 * rewrites that column from the copy it read at the START of a rescore, so an adjustment saved while a
 * rescore was in flight would be silently dropped.
 *
 * Points leagues only: in a category league the "score" is categories won, and a point means nothing.
 *
 * Pure.
 */

export const SCORE_ADJUSTMENTS_KEY = 'commissioner_score_adjustments'
export const MAX_ADJUSTMENT_POINTS = 500
export const MAX_ADJUSTMENTS_PER_LEAGUE = 500
export const REASON_MIN = 3
export const REASON_MAX = 200

export type ScoreAdjustment = {
  id: string
  matchupId: string
  /** `RedraftRoster.id` — the home or away side of that matchup. */
  rosterId: string
  week: number
  /** Added to the team's score: negative for a penalty. Two decimals at most. */
  points: number
  reason: string
  byUserId: string
  at: string
  /**
   * Set when the adjustment applies a stat correction the league office posted after the week was
   * sealed (lib/stat-corrections). Absent on a commissioner's own adjustment.
   */
  source?: 'stat_correction'
}

const round2 = (n: number) => Math.round(n * 100) / 100

function isAdjustment(x: unknown): x is ScoreAdjustment {
  const a = x as Partial<ScoreAdjustment> | null
  return Boolean(
    a && typeof a.id === 'string' && typeof a.matchupId === 'string' && typeof a.rosterId === 'string' &&
      typeof a.week === 'number' && typeof a.points === 'number' && Number.isFinite(a.points) &&
      typeof a.reason === 'string' && typeof a.byUserId === 'string' && typeof a.at === 'string',
  )
}

/** Every adjustment in the league. An unreadable entry is dropped rather than breaking a rescore. */
export function readScoreAdjustments(settings: unknown): ScoreAdjustment[] {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[SCORE_ADJUSTMENTS_KEY] : null
  return Array.isArray(s) ? s.filter(isAdjustment) : []
}

/** Net points added to one team's score in one matchup. */
export function adjustmentFor(list: readonly ScoreAdjustment[], matchupId: string, rosterId: string): number {
  let sum = 0
  for (const a of list) if (a.matchupId === matchupId && a.rosterId === rosterId) sum += a.points
  return round2(sum)
}

/**
 * The actor automatic corrections are recorded under (lib/stat-corrections/extendedCorrections.ts
 * re-exports it). Defined here so this module can recognise them without importing that one.
 */
export const STAT_CORRECTION_ACTOR = 'system:stat-corrections'

/**
 * Whether an adjustment applies a stat correction: the commissioner's Apply (tagged `source`) or an
 * automatic extended correction (recorded under STAT_CORRECTION_ACTOR). Both paths count both, so a
 * correction landed one way is never added again the other way.
 */
export function isStatCorrectionAdjustment(a: ScoreAdjustment): boolean {
  return a.source === 'stat_correction' || a.byUserId === STAT_CORRECTION_ACTOR
}

/** The part of a team's adjustment in one matchup that applies stat corrections. */
export function statCorrectionApplied(list: readonly ScoreAdjustment[], matchupId: string, rosterId: string): number {
  return adjustmentFor(list.filter(isStatCorrectionAdjustment), matchupId, rosterId)
}

/** A computed score with the commissioner's adjustment on top. */
export function adjustedScore(computed: number, list: readonly ScoreAdjustment[], matchupId: string, rosterId: string): number {
  const adj = adjustmentFor(list, matchupId, rosterId)
  return adj === 0 ? computed : round2(computed + adj)
}

export type AdjustmentInputError = 'bad_points' | 'bad_reason' | 'bad_target'

/** Validate a commissioner's adjustment. Strict: nothing is clamped or trimmed into a different value. */
export function parseAdjustmentInput(body: unknown): { ok: true; value: { matchupId: string; rosterId: string; points: number; reason: string } } | { ok: false; error: AdjustmentInputError } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (typeof b.matchupId !== 'string' || !b.matchupId || typeof b.rosterId !== 'string' || !b.rosterId) return { ok: false, error: 'bad_target' }
  const points = b.points
  if (typeof points !== 'number' || !Number.isFinite(points) || points === 0 || Math.abs(points) > MAX_ADJUSTMENT_POINTS || round2(points) !== points) {
    return { ok: false, error: 'bad_points' }
  }
  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return { ok: false, error: 'bad_reason' }
  return { ok: true, value: { matchupId: b.matchupId, rosterId: b.rosterId, points, reason } }
}

export const ADJUSTMENT_ERROR_TEXT: Record<AdjustmentInputError, string> = {
  bad_points: `Points must be a non-zero number up to ${MAX_ADJUSTMENT_POINTS}, with at most two decimals.`,
  bad_reason: `Give a reason (${REASON_MIN}–${REASON_MAX} characters). It shows in the audit log.`,
  bad_target: 'Choose a team in a matchup.',
}

/** "+3.5" / "−2" for display. */
export function formatAdjustment(points: number): string {
  return `${points > 0 ? '+' : '−'}${Math.abs(points)}`
}
