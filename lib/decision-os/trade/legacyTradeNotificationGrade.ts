/**
 * The grade stored on a `TradeNotification` (`/api/legacy/trades/check`), and what a client may see of
 * it. PURE.
 *
 * Rows written from 2026-09-27 carry the one engine's letter and a validated explanation, marked with
 * `engine`. Rows written before carry a letter GPT produced from player names alone, on its own A+..F
 * scale. Those are HIDDEN, not shown beside engine grades: two scales on one screen is the thing the
 * one trade engine exists to remove, and Chimmy turned that letter into a "Trade score" out of 100.
 */

export const ENGINE_ANALYSIS_MARKER = 'trade-eval-v1'

export type EngineTradeAnalysis = {
  engine: typeof ENGINE_ANALYSIS_MARKER
  receiptId: string | null
  /** The sender's letter. Null when withheld. */
  grade: string | null
  partnerGrade: string | null
  gradeWithheld: string | null
  verdict: string | null
  expertAnalysis: string
  reasons: string[]
  risks: string[]
  explanationSource: 'ai' | 'template'
}

/** True for an analysis the one engine wrote; false for a pre-cutover GPT letter. */
export function isEngineAnalysis(value: unknown): value is EngineTradeAnalysis {
  return Boolean(value && typeof value === 'object' && (value as { engine?: unknown }).engine === ENGINE_ANALYSIS_MARKER)
}

export function shownTradeGrade<T extends { aiGrade: string | null; aiVerdict: string | null; aiAnalysis: unknown }>(row: T) {
  return isEngineAnalysis(row.aiAnalysis)
    ? { aiGrade: row.aiGrade, aiVerdict: row.aiVerdict, aiAnalysis: row.aiAnalysis as EngineTradeAnalysis }
    : { aiGrade: null, aiVerdict: null, aiAnalysis: null }
}
