import { TOKEN_ENTRY_TYPES } from './constants'

/**
 * Tokens a viewer spent per week, from their own `token_ledger` rows — the Plans page's spend chart.
 *
 * ⚠ NET OF REFUNDS. A refund is written as its own positive `refund` row against the spend it undoes
 * (TokenSpendService), so counting `spend` rows alone would show tokens the viewer got back. A week's
 * figure is spends minus refunds, floored at zero (a refund can land in the week after its spend).
 *
 * ⚠ PURCHASES AND ADJUSTMENTS ARE NOT SPEND. Buying a pack and the daily free grant move the balance
 * but are not tokens used, so they never enter this figure.
 *
 * Weeks run Monday 00:00 UTC to Monday, the same for every viewer, oldest first; the current week is
 * the last bar and is partial.
 */
export type TokenSpendRow = { createdAt: Date; entryType: string; tokenDelta: number }
export type WeeklyTokenSpend = { weekStart: string; spent: number }

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function weekStartUtc(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  const dow = (d.getUTCDay() + 6) % 7 // Monday = 0
  return new Date(d.getTime() - dow * 24 * 60 * 60 * 1000)
}

export function weeklyTokenSpend(rows: readonly TokenSpendRow[], now: Date, weeks = 8): WeeklyTokenSpend[] {
  const last = weekStartUtc(now).getTime()
  const first = last - (weeks - 1) * WEEK_MS
  const sums = new Array<number>(weeks).fill(0)
  for (const r of rows) {
    const t = r.createdAt.getTime()
    if (t < first || t >= last + WEEK_MS) continue
    const i = Math.floor((t - first) / WEEK_MS)
    if (r.entryType === TOKEN_ENTRY_TYPES.SPEND && r.tokenDelta < 0) sums[i] += -r.tokenDelta
    else if (r.entryType === TOKEN_ENTRY_TYPES.REFUND && r.tokenDelta > 0) sums[i] -= r.tokenDelta
  }
  return sums.map((spent, i) => ({ weekStart: new Date(first + i * WEEK_MS).toISOString().slice(0, 10), spent: Math.max(0, spent) }))
}
