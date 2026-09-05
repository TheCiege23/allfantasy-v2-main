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
