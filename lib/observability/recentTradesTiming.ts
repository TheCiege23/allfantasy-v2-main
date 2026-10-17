import { recordCompletedSpan } from './rootTiming'

type TradeReadPhase = 'ledger' | 'grade-cache' | 'reconcile' | 'provider' | 'media' | 'grading'
/** Fixed phase names and durations only: never trade, league, account or asset details. */
export function recentTradesTiming() {
  const started = performance.now()
  const phases: Partial<Record<TradeReadPhase, number>> = {}
  return {
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
        if (totalMs >= 2500) console.info('[core-trades-timing]', JSON.stringify({ totalMs, phases }))
      } catch { /* Diagnostics cannot fail the card. */ }
    },
  }
}
