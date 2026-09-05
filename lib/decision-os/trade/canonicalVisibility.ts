/**
 * Decision OS — Phase 3B (trade): show the canonical grade ALONGSIDE the console verdict.
 *
 * 🛑 THIS NEVER REPLACES AN ANSWER. The console's own value maths continues to decide the verdict,
 * the percentages and the labels; this adds a second opinion beside it and nothing more. The flip —
 * canonical becoming the answer — is a separate, later decision that this deliberately does not
 * make, because the trade surface has ONE recorded verdict against the flip gate's bar of fifty.
 *
 * WHY THIS IS CHEAP: the canonical grade is already computed on every console evaluation. The
 * analyze route builds it via `compareConsoleVerdictWithCanonicalGrade`, hands it to
 * `recordTradeSurfaceShadow` for telemetry, and then throws it away. Phase 3B (alongside) is
 * therefore a serving path over an existing computation, not a new engine.
 *
 * ⚠ TRADE IS THE ONLY DOMAIN WHERE THIS IS HONEST. The lineup slice's Decision OS path is fed the
 * legacy summary AS its own recommender, so showing "both" there would show one answer twice. Trade
 * genuinely runs two independent engines — the console's value maths and `buildTradeValueSnapshot`.
 */

/** Off unless the value is exactly 'true', matching every other Decision OS gate in this repo. */
export const TRADE_CANONICAL_VISIBLE_FLAG = 'DECISION_OS_TRADE_CANONICAL_VISIBLE' as const

export function tradeCanonicalVisible(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[TRADE_CANONICAL_VISIBLE_FLAG] ?? '').trim().toLowerCase() === 'true'
}

/**
 * What the client is given. Every field is nullable because the canonical engine is allowed to
 * refuse, and a refusal must read as "no opinion" rather than as a neutral grade.
 */
export interface TradeCanonicalOpinion {
  /** Null when the canonical engine could not price the trade. NEVER render null as a grade. */
  grade: string | null
  /** 0–100. Zero means the engine had nothing to go on, not that it judged the trade even. */
  confidence: number
  /** Null when the engine refused, or when the console said 'mixed' and the two are incomparable. */
  advantage: 'even' | 'you' | 'opponent' | null
  /**
   * Null means NO VERDICT — the comparison could not be scored either way. It must never be
   * rendered as agreement; that is the same error the flip gate exists to avoid, and it has
   * already been fixed once in the telemetry path.
   */
  agreesWithConsole: boolean | null
}

/**
 * Project the shadow comparison into the client-facing shape. Returns null when the flag is off or
 * no comparison was produced, so the response field is simply absent rather than empty-and-present.
 */
export function toTradeCanonicalOpinion(
  comparison: {
    canonicalGrade: string | null
    canonicalConfidenceScore: number
    canonicalAdvantage: 'even' | 'you' | 'opponent' | null
    agreement: boolean | null
  } | null,
  env: NodeJS.ProcessEnv = process.env,
): TradeCanonicalOpinion | null {
  if (!tradeCanonicalVisible(env)) return null
  if (!comparison) return null
  return {
    grade: comparison.canonicalGrade,
    confidence: comparison.canonicalConfidenceScore,
    advantage: comparison.canonicalAdvantage,
    agreesWithConsole: comparison.agreement,
  }
}

/**
 * 🛑 THE THIRD STATE, WHICH WAS DECLARED IN A COMMENT AND NOT IMPLEMENTED.
 *
 * Phase 3B's render carried a comment naming three honesty states — grade null, agreement null, and
 * confidence 0 — and then branched on `grade` alone. Nothing caught it, because the modal has no
 * test of any kind. Production says that omission is not theoretical: EVERY trade observation
 * recorded so far (4 of 4, 2026-09-04 to 09-05, all authenticated and league-scoped) carries
 * `confidenceScore: 0` while still producing a grade — A+, A+, C+, B-. Rendering those by the old
 * branch reads "Grade A+ · confidence 0/100", leading in bright text with a grade for a deal in
 * which nothing could be priced.
 *
 * That is the same conflation `consoleShadowCompare` already refuses at line 169 ("ZERO CONFIDENCE
 * IS NOT AGREEMENT"), reached one layer further out. The engine withdraws the agreement claim; the
 * UI must withdraw the grade claim for the same reason and on the same threshold.
 *
 * Returned as a state rather than decided in JSX SO THAT IT CAN BE TESTED. A comment above a ternary
 * is exactly what failed here.
 */
export type TradeCanonicalDisplayState =
  /** The engine could not price the trade at all. Never print a grade. */
  | { kind: 'unpriced' }
  /** A grade exists but rests on nothing. Never lead with it; it is not a neutral verdict. */
  | { kind: 'no_signal'; grade: string }
  /** A real second opinion, with some signal behind it. */
  | { kind: 'opinion'; grade: string; confidence: number; agreesWithConsole: boolean | null }

/**
 * Zero is the line, matching `consoleShadowCompare`'s own boundary rather than inventing a floor:
 * any positive confidence is some signal and is shown, with its number, for the reader to weigh.
 * Non-finite or negative confidence is treated as no signal — a NaN must not pass as a number.
 */
export function describeTradeCanonicalOpinion(
  opinion: TradeCanonicalOpinion | null,
): TradeCanonicalDisplayState | null {
  if (!opinion) return null
  if (opinion.grade == null) return { kind: 'unpriced' }
  if (!Number.isFinite(opinion.confidence) || opinion.confidence <= 0) {
    return { kind: 'no_signal', grade: opinion.grade }
  }
  return {
    kind: 'opinion',
    grade: opinion.grade,
    confidence: opinion.confidence,
    agreesWithConsole: opinion.agreesWithConsole,
  }
}
