/**
 * Decision OS — parity adapters for the surfaces that do NOT use the canonical
 * value engine (Slice 13).
 *
 * The flip gate was blind to the two highest-traffic trade experiences:
 *   - af-legacy Trade Command Center (LLM grade constrained by FantasyCalc)
 *   - the five war rooms (each with its own value base + a copy-pasted
 *     accept/neutral/reject rule)
 * Neither will be converged in this slice. Instrumenting them makes the
 * divergence MEASURABLE, which is the precondition for ever flipping anything.
 *
 * Pure functions: they normalize each surface's native verdict vocabulary onto
 * the shared advantage vocabulary and compare it against the deterministic
 * engine's own read. No I/O.
 */

/** Shared vocabulary: who does the value favor, from the requesting manager's view. */
export type TradeAdvantage = 'even' | 'you' | 'opponent'

export interface SurfaceParityComparison {
  canonicalGrade: string | null
  canonicalFairnessScore: number | null
  canonicalConfidenceScore: number
  canonicalValueDifference: number
  canonicalAdvantage: string | null
  agreement: boolean | null
}

/**
 * af-legacy verdict strings → advantage. Legacy phrases verdicts from Team A's
 * perspective ("Slightly favors A"), and the requesting manager is always
 * Team A on that surface.
 */
export function legacyVerdictToAdvantage(verdict: string | null | undefined): TradeAdvantage | null {
  const v = String(verdict ?? '').trim().toLowerCase()
  if (!v) return null
  if (v === 'fair') return 'even'
  if (v.includes('favors a')) return 'you'
  if (v.includes('favors b')) return 'opponent'
  return null
}

/**
 * The deterministic trade engine's verdict → advantage, from the proposing
 * manager's view. 'counter' means the engine judged it close enough to
 * negotiate rather than lopsided, which maps to 'even'.
 */
export function engineVerdictToAdvantage(verdict: string | null | undefined): TradeAdvantage | null {
  switch (String(verdict ?? '').trim().toLowerCase()) {
    case 'accept':
      return 'you'
    case 'reject':
      return 'opponent'
    case 'counter':
      return 'even'
    default:
      return null
  }
}

/** War-room verdicts share one rule across all five formats. */
export function warRoomVerdictToAdvantage(verdict: string | null | undefined): TradeAdvantage | null {
  switch (String(verdict ?? '').trim().toLowerCase()) {
    case 'accept':
      return 'you'
    case 'reject':
      return 'opponent'
    case 'neutral':
      return 'even'
    // 'needs_more_data' is an honest abstention — never force it into a verdict.
    default:
      return null
  }
}

/**
 * One call site for all five war rooms, so instrumentation can't drift the way
 * their copy-pasted `adpToValue` did. They share the verdict rule
 * (composite >= 3 accept / <= -3 reject / else neutral) but use different value
 * bases, so each reports as its own surface.
 *
 * NOTE: the war rooms do not run the canonical engine, so there is no second
 * verdict to compare against here — these are recorded as structured
 * observations (surface verdict + value delta), which is what makes their
 * divergence from the canonical stack measurable at all. Wiring a canonical
 * counter-evaluation into the war rooms is the convergence step AFTER this.
 */
export function warRoomSurfaceObservation(input: {
  verdict: string | null | undefined
  valueDelta?: number | null
  rosterFitDelta?: number | null
}): { advantage: TradeAdvantage | null; abstained: boolean } {
  const advantage = warRoomVerdictToAdvantage(input.verdict)
  return {
    advantage,
    abstained: advantage === null,
  }
}

/**
 * Build the comparison payload from a surface verdict and the deterministic
 * engine's result. `agreement` stays null whenever either side abstained —
 * an abstention must never be scored as agreement, or the flip gate inflates.
 */
export function buildSurfaceParity(input: {
  surfaceAdvantage: TradeAdvantage | null
  engineAdvantage: TradeAdvantage | null
  engineGrade?: string | null
  engineFairnessScore?: number | null
  engineConfidenceScore?: number | null
  engineValueDifference?: number | null
}): SurfaceParityComparison {
  const agreement =
    input.surfaceAdvantage != null && input.engineAdvantage != null
      ? input.surfaceAdvantage === input.engineAdvantage
      : null

  return {
    canonicalGrade: input.engineGrade ?? null,
    canonicalFairnessScore: input.engineFairnessScore ?? null,
    canonicalConfidenceScore: input.engineConfidenceScore ?? 0,
    canonicalValueDifference: input.engineValueDifference ?? 0,
    canonicalAdvantage: input.engineAdvantage,
    agreement,
  }
}
