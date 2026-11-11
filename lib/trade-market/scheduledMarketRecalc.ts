import type { PrismaClient } from '@prisma/client'

import {
  bookKey,
  MARKET_BOOKS,
  recalculateFormatMarkets,
  writeLineupFactorTable,
  type BookResult,
  type LineupFactorTable,
} from './formatMarkets'

/**
 * The SCHEDULED writer for the AllFantasy trade market (rides `/api/cron/recompute-allfantasy-adp`).
 *
 * 🛑 THE WRITER EXISTED FOR TWO MONTHS WITH NO SCHEDULE. `recalculateFromCompletedTrades` ran once,
 * by hand, on 2026-09-06, and nothing ran it again — so the 283 values it wrote froze while ~7,000
 * further trades landed in `LeagueTrade`. Same shape as `ingestCFBDStats` (CLAUDE.md): a table nothing
 * refreshes looks correct and is not. The read layer ignores rows older than 21 days
 * (`afTradeMarketReads.ts`), so a writer that stops is VISIBLE as "no fresh market", never served.
 *
 * ⚠ ONE MARKET PER FORMAT (`formatMarkets.ts`): dynasty/redraft × 1QB/superflex, each trade measured on
 * the chart its own league is graded on, each book centring-gated on its own population.
 *
 * ⚠ FRESHEST CENTRED WINDOW WINS, PER BOOK. The current season is tried first; only the books it could not
 * publish (refused as not centred, or nothing reaching the evidence threshold) are retried on a wider
 * window. Each attempt is ONE gather with the gate evaluated inside the write, so the population judged
 * is the population stored. The lineup factor table comes from the freshest window that publishes at
 * least one factor — this season's trades are the ones whose league lineup is actually known.
 */
export type ScheduledMarketRecalcResult = {
  written: number
  published: number
  tradesUsed: number
  books: Array<BookResult & { sinceSeason: number }>
  lineup: { sinceSeason: number; published: number; measured: number } | null
  attempts: Array<{ sinceSeason: number; refused: string[]; written: number }>
}

export function marketWindows(now = new Date()): number[] {
  // NFL seasons start in September; before that, "this season" has no trades yet.
  const season = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return [season, season - 1, season - 2]
}

export async function runScheduledMarketRecalc(
  prisma: PrismaClient,
  opts: { now?: Date; recalc?: typeof recalculateFormatMarkets; writeLineup?: typeof writeLineupFactorTable } = {},
): Promise<ScheduledMarketRecalcResult> {
  const recalc = opts.recalc ?? recalculateFormatMarkets
  const writeLineup = opts.writeLineup ?? writeLineupFactorTable
  const done = new Set<string>()
  const books: ScheduledMarketRecalcResult['books'] = []
  const attempts: ScheduledMarketRecalcResult['attempts'] = []
  let lineupTable: LineupFactorTable | null = null
  let tradesUsed = 0

  for (const sinceSeason of marketWindows(opts.now)) {
    if (done.size === MARKET_BOOKS.length && lineupTable?.factors.some((f) => f.published)) break
    const r = await recalc(prisma, { sinceSeason, dryRun: false, requireCentred: true, skipBooks: done, writeLineupFactors: false, now: opts.now })
    tradesUsed = Math.max(tradesUsed, r.tradesUsed)
    attempts.push({ sinceSeason, refused: r.books.filter((b) => b.refused).map((b) => b.concept), written: r.books.reduce((s, b) => s + b.written, 0) })
    for (const b of r.books) {
      // A book a fresher window already published is never replaced by an older one.
      if (b.written > 0 && !done.has(bookKey(b.book))) {
        done.add(bookKey(b.book))
        books.push({ ...b, sinceSeason })
      }
    }
    if (!lineupTable || (!lineupTable.factors.some((f) => f.published) && r.lineup.factors.some((f) => f.published))) {
      lineupTable = r.lineup
    }
  }

  let lineup: ScheduledMarketRecalcResult['lineup'] = null
  if (lineupTable) {
    await writeLineup(prisma, lineupTable)
    lineup = {
      sinceSeason: lineupTable.sinceSeason,
      published: lineupTable.factors.filter((f) => f.published).length,
      measured: lineupTable.factors.length,
    }
  }
  return {
    written: books.reduce((s, b) => s + b.written, 0),
    published: books.reduce((s, b) => s + b.published, 0),
    tradesUsed,
    books,
    lineup,
    attempts,
  }
}
