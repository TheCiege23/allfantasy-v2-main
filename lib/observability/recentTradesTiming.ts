import { recordCompletedSpan } from './rootTiming'

type TradeReadPhase = 'ledger' | 'grade-cache' | 'reconcile' | 'provider' | 'media' | 'frozen' | 'grading'

/**
 * What happened to each visible trade's grade on this read (2026-11-22). Added because the owner's 91-league home
 * re-graded every visible trade on every open — none of their trades had a stored original — and nothing said why.
 *
 * - `stored`        its original was already on record: no pricing at all.
 * - `tradeDate`     priced on its trade date and saved — the next read is `stored`.
 * - `firstGraded`   no record from the trade date, so today's letter was saved as the original.
 * - `saveFailed`    priced, but the save failed: today's letter is shown and the next read prices it again.
 * - `unfrozen`      graded, but neither stored nor saved (a stored row for a different deal).
 * - `ungraded:<why>` no letter, so nothing to store — and every read prices it again. `<why>` is a fixed bucket,
 *   never the reason text (a Pirate steal's sentence names managers).
 * - `failed`        the grade threw.
 * - `provider`      a provider trade the ledger has not reached, graded from its own assets.
 */
export type TradeGradeOutcome =
  | 'stored' | 'tradeDate' | 'firstGraded' | 'saveFailed' | 'unfrozen' | 'failed' | 'provider'
  | `ungraded:${UngradedBucket}`

export type UngradedBucket =
  | 'noValues' | 'unpriced' | 'noAssets' | 'invalidValues' | 'noUsableValue' | 'gapUnmeasured'
  | 'multiTeam' | 'noSides' | 'pirateSteal' | 'giveaway' | 'budget' | 'other'

/** A fixed bucket for an ungraded reason. Matches the reason strings the graders return; anything new is `other`. */
export function ungradedBucket(reason: string | null | undefined, kind?: string | null): UngradedBucket {
  if (kind === 'pirate_steal') return 'pirateSteal'
  const r = String(reason ?? '')
  if (/values could not be loaded/i.test(r)) return 'noValues'
  if (/no value on this league/i.test(r)) return 'unpriced'
  if (/has no assets recorded/i.test(r)) return 'noAssets'
  if (/asset values are invalid/i.test(r)) return 'invalidValues'
  if (/carry no usable value/i.test(r)) return 'noUsableValue'
  if (/value gap could not be measured/i.test(r)) return 'gapUnmeasured'
  if (/only two-team trades/i.test(r)) return 'multiTeam'
  if (/no sides on record/i.test(r)) return 'noSides'
  if (/giveaway|nothing in return|for nothing/i.test(r)) return 'giveaway'
  if (/waiver budget|FAAB/i.test(r)) return 'budget'
  return 'other'
}

/** Fixed phase names, durations and outcome counts only: never trade, league, account or asset details. */
export function recentTradesTiming() {
  const started = performance.now()
  const phases: Partial<Record<TradeReadPhase, number>> = {}
  const grades: Partial<Record<TradeGradeOutcome, number>> = {}
  return {
    grade(outcome: TradeGradeOutcome) {
      grades[outcome] = (grades[outcome] ?? 0) + 1
    },
    async read<T>(phase: TradeReadPhase, load: () => Promise<T>): Promise<T> {
      const start = performance.now(), spanStart = Date.now()
      try { return await load() } finally {
        phases[phase] = Math.max(0, Math.round(performance.now() - start))
        recordCompletedSpan({ name: `home-trades.${phase}`, op: 'core.trade.read', startedAtMs: spanStart })
      }
    },
    finish() {
      try {
        const totalMs = Math.max(0, Math.round(performance.now() - started))
        if (totalMs < 2500) return
        console.info('[core-trades-timing]', JSON.stringify(Object.keys(grades).length ? { totalMs, phases, grades } : { totalMs, phases }))
      } catch { /* Diagnostics cannot fail the card. */ }
    },
  }
}
