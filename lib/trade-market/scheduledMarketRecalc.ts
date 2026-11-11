import type { PrismaClient } from '@prisma/client'

import { recalculateFromCompletedTrades } from './completedTradeObservations'

/**
 * The SCHEDULED writer for the AllFantasy trade market (`/api/cron/af-market-values`).
 *
 * 🛑 THE WRITER EXISTED FOR TWO MONTHS WITH NO SCHEDULE. `recalculateFromCompletedTrades` ran once,
 * by hand, on 2026-09-06, and nothing ran it again — so the 283 values it wrote froze while ~7,000
 * further trades landed in `LeagueTrade`. Same shape as `ingestCFBDStats` (CLAUDE.md): a table nothing
 * refreshes looks correct and is not. The read layer now ignores rows older than 21 days
 * (`afTradeMarketReads.ts`), so a writer that stops is VISIBLE as "no fresh market", never served.
 *
 * ⚠ FRESHEST CENTRED WINDOW WINS. The market should describe what managers pay NOW, so the run tries
 * the current season's trades first and widens only if that population fails the centring gate
 * (trades are zero-sum, so a biased population is an estimator artefact, not a market — see
 * `sinceSeasonArg.ts`, where `--since 2025` measured +1.8% and was refused). Each attempt is ONE
 * gather with the gate evaluated inside the write (`requireCentred`), so the population judged is the
 * population stored. A refused attempt writes nothing.
 *
 * If every window is refused, nothing is written and the job reports it as a warning — the old rows
 * age out of the read layer on their own.
 */
export type ScheduledMarketRecalcResult = {
  written: number
  published: number
  tradesUsed: number
  sinceSeason: number | null
  medianAdjustment: number | null
  attempts: Array<{ sinceSeason: number; refused: string | null; medianAdjustment: number | null; written: number }>
}

export function marketWindows(now = new Date()): number[] {
  // NFL seasons start in September; before that, "this season" has no trades yet.
  const season = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return [season, season - 1, season - 2]
}

export async function runScheduledMarketRecalc(
  prisma: PrismaClient,
  opts: { now?: Date; recalc?: typeof recalculateFromCompletedTrades } = {},
): Promise<ScheduledMarketRecalcResult> {
  const recalc = opts.recalc ?? recalculateFromCompletedTrades
  const attempts: ScheduledMarketRecalcResult['attempts'] = []
  for (const sinceSeason of marketWindows(opts.now)) {
    const r = await recalc(prisma, { sport: 'NFL', sinceSeason, dryRun: false, requireCentred: true })
    attempts.push({ sinceSeason, refused: r.refused, medianAdjustment: r.medianAdjustment, written: r.written })
    if (r.refused === null && r.written > 0) {
      return {
        written: r.written,
        published: r.published,
        tradesUsed: r.tradesUsed,
        sinceSeason,
        medianAdjustment: r.medianAdjustment,
        attempts,
      }
    }
  }
  return { written: 0, published: 0, tradesUsed: 0, sinceSeason: null, medianAdjustment: null, attempts }
}
