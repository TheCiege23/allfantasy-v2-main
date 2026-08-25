/**
 * Persist manager trade tendencies. The arithmetic lives in `ManagerTendencyBuilder.ts`.
 */

import type { ManagerTendencyRow } from './ManagerTendencyBuilder'

/**
 * The client is INJECTED rather than imported.
 *
 * `@/lib/prisma` is server-only, which is correct for the app and makes the writer
 * unreachable from a script — and a writer that cannot be run from a backfill is a writer that
 * never fills the table it was built for. Taking the client as an argument keeps the app path
 * unchanged and lets the same code do the backfill.
 */
type TendencyClient = {
  manager_trade_tendencies: {
    upsert: (args: unknown) => Promise<unknown>
  }
}

export interface WriteTendenciesResult {
  managers: number
  withRatio: number
  withPickPreference: number
  withYouthPreference: number
  written: number
  errors: string[]
}

/**
 * Persist the computed rows.
 *
 * ⚠ THE UPSERT DELIBERATELY OMITS `trades_sent`. Naming it in the update would overwrite
 * whatever an offer-aware writer had recorded with a number this source cannot know.
 */
export async function writeManagerTendencies(
  rows: readonly ManagerTendencyRow[],
  client: TendencyClient,
): Promise<WriteTendenciesResult> {
  const result: WriteTendenciesResult = {
    managers: rows.length,
    withRatio: rows.filter((r) => r.avg_overpay_ratio != null).length,
    withPickPreference: rows.filter((r) => r.prefers_picks != null).length,
    withYouthPreference: rows.filter((r) => r.prefers_youth != null).length,
    written: 0,
    errors: [],
  }

  for (const row of rows) {
    const fields = {
      leagues_played: row.leagues_played,
      trades_accepted: row.trades_accepted,
      avg_overpay_ratio: row.avg_overpay_ratio,
      prefers_youth: row.prefers_youth,
      prefers_picks: row.prefers_picks,
      risk_tolerance: row.risk_tolerance,
      updated_at: new Date(),
    }
    try {
      await client.manager_trade_tendencies.upsert({
        where: { user_id: row.user_id },
        create: { user_id: row.user_id, ...fields },
        update: fields,
      })
      result.written += 1
    } catch (e) {
      if (result.errors.length < 5) {
        result.errors.push(`${row.user_id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return result
}
