import type { PrismaClient } from '@prisma/client'

import {
  bookKey,
  MARKET_BOOKS,
  recalculateFormatMarkets,
  stampAllTradeFormats,
  writeLineupFactorTable,
  writePickMarketTable,
  writePostureMarketTable,
  writeNeedMarketTable,
  type BookResult,
  type NeedBookResult,
  type PickBookResult,
  type PostureBookResult,
  type LineupFactorTable,
  type StampAllResult,
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
 * least one factor; a wider window adds past seasons, each read on its own lineup (`seasonLeagueRow`),
 * which is what lets thin formats like 4-QB gather enough trades to be measured at all.
 */
export type ScheduledMarketRecalcResult = {
  written: number
  published: number
  tradesUsed: number
  books: Array<BookResult & { sinceSeason: number }>
  lineup: { sinceSeason: number; published: number; measured: number } | null
  attempts: Array<{ sinceSeason: number; refused: string[]; written: number }>
  /** `LeagueTrade` rows given a `leagueFormat` / `isSuperFlex` this run (only empty rows are filled). */
  tradesStamped: number
  /**
   * The dated market (`datedMarketLearner.ts`) per book, from the FRESHEST window — every book, published or not —
   * with its gap to the current market. This is what the switch to `TRADE_MARKET_LEARNER=dated` is decided on.
   */
  /** Every season's trades given a league type (`stampAllTradeFormats`); null when the pass failed. */
  formatBackfill: StampAllResult | null
  datedShadow: Array<{ concept: string; sinceSeason: number; learner: 'current' | 'dated' } & NonNullable<BookResult['dated']>>
  /** Pick values learned from the widest window's dynasty trades, stored once per run (`pickMarketLearner.ts`, shadow). */
  pickMarkets: Array<PickBookResult & { sinceSeason: number }>
  /** False when the pick table could not be stored this run. */
  pickMarketsWritten: boolean
  /** What contenders and rebuilders pay over middle teams, from the widest window (`postureMarketLearner.ts`, shadow). */
  postureMarkets: Array<PostureBookResult & { sinceSeason: number }>
  postureMarketsWritten: boolean
  /** What teams short of (or deep at) a position pay for it over normal-depth teams, widest window (`needMarketLearner.ts`, shadow). */
  needMarkets: Array<NeedBookResult & { sinceSeason: number }>
  needMarketsWritten: boolean
}

export function marketWindows(now = new Date()): number[] {
  // NFL seasons start in September; before that, "this season" has no trades yet.
  const season = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return [season, season - 1, season - 2]
}

export async function runScheduledMarketRecalc(
  prisma: PrismaClient,
  opts: {
    now?: Date
    recalc?: typeof recalculateFormatMarkets
    writeLineup?: typeof writeLineupFactorTable
    stampAll?: typeof stampAllTradeFormats
    writePicks?: typeof writePickMarketTable
    writePosture?: typeof writePostureMarketTable
    writeNeed?: typeof writeNeedMarketTable
  } = {},
): Promise<ScheduledMarketRecalcResult> {
  const recalc = opts.recalc ?? recalculateFormatMarkets
  const writeLineup = opts.writeLineup ?? writeLineupFactorTable
  const done = new Set<string>()
  const books: ScheduledMarketRecalcResult['books'] = []
  const attempts: ScheduledMarketRecalcResult['attempts'] = []
  let lineupTable: LineupFactorTable | null = null
  let tradesUsed = 0
  let tradesStamped = 0
  const datedShadow: ScheduledMarketRecalcResult['datedShadow'] = []
  let pickMarkets: ScheduledMarketRecalcResult['pickMarkets'] = []
  let postureMarkets: ScheduledMarketRecalcResult['postureMarkets'] = []
  let needMarkets: ScheduledMarketRecalcResult['needMarkets'] = []

  const windows = marketWindows(opts.now)
  const published = (t: LineupFactorTable | null) => (t ? t.factors.filter((f) => f.published).length : -1)
  const attempted = new Set<number>()
  for (const sinceSeason of windows) {
    if (done.size === MARKET_BOOKS.length) break
    attempted.add(sinceSeason)
    // The widest window covers every season the market reads, so it is the one that stamps trades.
    const stampTrades = sinceSeason === windows[windows.length - 1]
    const r = await recalc(prisma, { sinceSeason, dryRun: false, requireCentred: true, skipBooks: done, writeLineupFactors: false, stampTrades, now: opts.now })
    tradesUsed = Math.max(tradesUsed, r.tradesUsed)
    tradesStamped += r.tradesStamped ?? 0
    // Picks keep the WIDEST window: recency weights already favour fresh trades, and a pick class needs every trade it can get.
    if (sinceSeason === windows[windows.length - 1]) {
      pickMarkets = (r.pickMarkets ?? []).map((m) => ({ ...m, sinceSeason }))
      postureMarkets = (r.postureMarkets ?? []).map((m) => ({ ...m, sinceSeason }))
      needMarkets = (r.needMarkets ?? []).map((m) => ({ ...m, sinceSeason }))
    }
    // The freshest window measures every book (nothing is skipped yet), so its comparison is the complete one.
    if (sinceSeason === windows[0]) {
      for (const b of r.books) if (b.dated) datedShadow.push({ concept: b.concept, sinceSeason, learner: b.learner ?? 'current', ...b.dated })
    }
    attempts.push({ sinceSeason, refused: r.books.filter((b) => b.refused).map((b) => b.concept), written: r.books.reduce((s, b) => s + b.written, 0) })
    for (const b of r.books) {
      // A book a fresher window already published is never replaced by an older one.
      if (b.written > 0 && !done.has(bookKey(b.book))) {
        done.add(bookKey(b.book))
        books.push({ ...b, sinceSeason })
      }
    }
    // Most published factors wins; on a tie the fresher (earlier) window is kept.
    if (published(r.lineup) > published(lineupTable)) lineupTable = r.lineup
  }

  /*
   * ⚠ LINEUP FACTORS ALWAYS GET THE WIDEST WINDOW. A lineup effect is structural — how many tight ends a
   * league starts does not change week to week the way one player's price does — and the thin formats
   * (4-QB, 2-TE) are exactly the ones a single season cannot measure. Past seasons are read on their own
   * lineups (`seasonLeagueRow`). One extra gather, markets untouched (every book skipped).
   */
  const widest = windows[windows.length - 1]!
  if (!attempted.has(widest)) {
    const all = new Set(MARKET_BOOKS.map(bookKey))
    const r = await recalc(prisma, { sinceSeason: widest, dryRun: false, requireCentred: true, skipBooks: all, writeLineupFactors: false, stampTrades: true, now: opts.now })
    if (published(r.lineup) > published(lineupTable)) lineupTable = r.lineup
    tradesStamped += r.tradesStamped ?? 0
    pickMarkets = (r.pickMarkets ?? []).map((m) => ({ ...m, sinceSeason: widest }))
    postureMarkets = (r.postureMarkets ?? []).map((m) => ({ ...m, sinceSeason: widest }))
    needMarkets = (r.needMarkets ?? []).map((m) => ({ ...m, sinceSeason: widest }))
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
  const now = opts.now ?? new Date()
  const pickMarketsWritten = pickMarkets.length
    ? await (opts.writePicks ?? writePickMarketTable)(prisma, pickMarkets, now).then(() => true, () => false)
    : false
  const postureMarketsWritten = postureMarkets.length
    ? await (opts.writePosture ?? writePostureMarketTable)(prisma, postureMarkets, now).then(() => true, () => false)
    : false
  const needMarketsWritten = needMarkets.length
    ? await (opts.writeNeed ?? writeNeedMarketTable)(prisma, needMarkets, now).then(() => true, () => false)
    : false
  // Last and best-effort: labelling old trades must never cost the markets this run already wrote.
  const formatBackfill = await (opts.stampAll ?? stampAllTradeFormats)(prisma).catch(() => null)

  return {
    written: books.reduce((s, b) => s + b.written, 0),
    published: books.reduce((s, b) => s + b.published, 0),
    tradesUsed,
    books,
    lineup,
    attempts,
    tradesStamped,
    formatBackfill,
    datedShadow,
    pickMarkets,
    pickMarketsWritten,
    postureMarkets,
    postureMarketsWritten,
    needMarkets,
    needMarketsWritten,
  }
}
