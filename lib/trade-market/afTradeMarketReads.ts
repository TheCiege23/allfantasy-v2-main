import type { PrismaClient } from '@prisma/client'

import type { LeagueValueAdjustment } from '@/lib/trade-value/leagueTradeValue'
import type { LineupPosition, LineupProfile } from '@/lib/league/lineupProfile'
import { COMPLETED_SOURCE_VERSION } from './completedTradeObservations'
import {
  bookConcept,
  lineupDemand,
  LINEUP_FACTORS_CACHE_KEY,
  type LineupFactorTable,
  type MarketBook,
} from './formatMarkets'

/**
 * DB-FIRST READS of the AllFantasy trade market — player values derived from trades that actually
 * happened in AllFantasy-connected leagues (`formatMarkets.ts` writes them; the daily ADP cron runs the
 * rebuild). Request paths read here; nothing here calls a provider.
 *
 * 🛑 ONE MARKET PER FORMAT. A trade is only evidence about the format it was made in, so values are
 * kept per book — dynasty/redraft × 1QB/superflex — and a grade reads the book its own chart is. A
 * superflex grade never sees a 1QB market, and quarterbacks are no longer left out: each book prices
 * them on the right chart.
 *
 * 🛑 A STALE ROW IS NOT A MARKET. Each book is centring-gated on its own population and may stop
 * publishing; when it does its rows stop moving while the chart underneath keeps moving. Rows (and the
 * lineup factor table) older than `AF_MARKET_MAX_AGE_DAYS` are therefore ignored, not served.
 */

export const AF_MARKET_SPORT = 'NFL'
export const AF_MARKET_MAX_AGE_DAYS = 21

export type AfMarketRow = {
  playerId: string
  playerName: string | null
  position: string | null
  baseValue: number
  marketValue: number
  adjustmentPercent: number
  confidence: number
  sampleSize: number
  direction: string
  generatedAt: Date
}

/*
 * Structural so a unit test can pass a stub; `any` on the argument because Prisma's `findMany` is
 * generic in its argument and no concrete parameter type is assignable from it.
 */
type MarketDelegate = {
  allFantasyMarketPlayerValue: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany: (args: any) => PromiseLike<unknown>
  }
}

type CacheDelegate = {
  sportsDataCache: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique: (args: any) => PromiseLike<unknown>
  }
}

const SELECT = {
  playerId: true,
  playerName: true,
  position: true,
  baseValue: true,
  marketValue: true,
  adjustmentPercent: true,
  confidence: true,
  sampleSize: true,
  direction: true,
  generatedAt: true,
} as const

async function findRows(prisma: MarketDelegate, where: Record<string, unknown>): Promise<AfMarketRow[]> {
  try {
    const rows = await prisma.allFantasyMarketPlayerValue.findMany({ where, select: SELECT })
    return Array.isArray(rows) ? (rows as AfMarketRow[]) : []
  } catch {
    return []
  }
}

function freshSince(now: Date): Date {
  return new Date(now.getTime() - AF_MARKET_MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
}

function freshWhere(book: MarketBook, now: Date) {
  return {
    sport: AF_MARKET_SPORT,
    leagueConcept: bookConcept(book),
    sourceVersion: COMPLETED_SOURCE_VERSION,
    published: true,
    generatedAt: { gte: freshSince(now) },
  }
}

/** The book a chart is: what the grade priced on, and therefore the only market it may read. */
export function bookForChart(chart: { chartIsDynasty: boolean; isSuperFlex: boolean }): MarketBook {
  return { format: chart.chartIsDynasty ? 'DYNASTY' : 'REDRAFT', qbFormat: chart.isSuperFlex ? 'SUPERFLEX' : 'ONE_QB' }
}

export function bookLabel(book: MarketBook): string {
  return `${book.format === 'DYNASTY' ? 'Dynasty' : 'Redraft'} · ${book.qbFormat === 'SUPERFLEX' ? 'Superflex' : '1QB'}`
}

/** Is a row usable as an adjustment on a grade? Pure, so the rule is testable without a database. */
export function isApplicableMarketRow(row: Pick<AfMarketRow, 'adjustmentPercent' | 'sampleSize' | 'generatedAt'>, now = new Date()): boolean {
  if (!Number.isFinite(row.adjustmentPercent) || row.adjustmentPercent === 0) return false
  if (row.sampleSize < 5) return false
  return row.generatedAt.getTime() >= freshSince(now).getTime()
}

/** The visible grade adjustment one market row produces. */
export function tradeMarketAdjustment(row: Pick<AfMarketRow, 'adjustmentPercent' | 'sampleSize'>, book?: MarketBook): LeagueValueAdjustment {
  const pct = Math.round(row.adjustmentPercent * 10) / 10
  const signed = `${pct > 0 ? '+' : ''}${pct}%`
  return {
    kind: 'tradeMarket',
    factor: 1 + pct / 100,
    reason: `AllFantasy trade market ${signed}: what managers actually paid for him across ${row.sampleSize} completed ${book ? `${bookLabel(book)} ` : ''}trades in AllFantasy-connected leagues`,
  }
}

/**
 * Fresh, applicable market rows for these Sleeper ids in ONE book. Empty map on any read failure — the
 * grade then runs on the chart alone, which is exactly what it did before this layer existed.
 */
export async function loadAfTradeMarketRows(
  prisma: MarketDelegate,
  sleeperIds: readonly string[],
  book: MarketBook,
  now = new Date(),
): Promise<Map<string, AfMarketRow>> {
  const ids = [...new Set(sleeperIds.map((s) => s.trim()).filter((s) => /^\d+$/.test(s)))]
  const out = new Map<string, AfMarketRow>()
  if (ids.length === 0) return out
  const rows = await findRows(prisma, { ...freshWhere(book, now), playerId: { in: ids } })
  for (const r of rows) if (isApplicableMarketRow(r, now)) out.set(r.playerId, r)
  return out
}

// ─── Lineup factors ─────────────────────────────────────────────────────────────────────────────────

/** The measured lineup factor table, or null when it is missing or older than the market horizon. */
export async function loadLineupFactors(prisma: CacheDelegate, now = new Date()): Promise<LineupFactorTable | null> {
  try {
    const row = (await prisma.sportsDataCache.findUnique({ where: { cacheKey: LINEUP_FACTORS_CACHE_KEY } })) as
      | { data: unknown; expiresAt: Date }
      | null
    if (!row || row.expiresAt.getTime() < now.getTime()) return null
    const table = row.data as LineupFactorTable
    return Array.isArray(table?.factors) ? table : null
  } catch {
    return null
  }
}

const POSITION_WORDS: Record<LineupPosition, [string, string]> = {
  QB: ['quarterback', 'quarterbacks'],
  RB: ['running back', 'running backs'],
  WR: ['receiver', 'receivers'],
  TE: ['tight end', 'tight ends'],
}

/**
 * The lineup adjustment for one player in one lineup, or null. PURE.
 *
 * Only a PUBLISHED factor applies — one measured with `LINEUP_MIN_*` breadth. A league whose lineup is
 * unusual but whose bucket has too little evidence gets no adjustment, and `lineupNote` says so.
 */
export function lineupAdjustment(
  table: LineupFactorTable | null,
  lineup: LineupProfile | null,
  position: string | null | undefined,
): LeagueValueAdjustment | null {
  const pos = String(position ?? '').toUpperCase() as LineupPosition
  if (!table || !lineup || !(pos in POSITION_WORDS)) return null
  const d = lineupDemand(lineup, pos)
  const band = table.usual[pos]
  if (!band) return null
  const bucket = d < band.low ? 'low' : d > band.high ? 'high' : null
  if (!bucket) return null
  const f = table.factors.find((x) => x.position === pos && x.bucket === bucket)
  if (!f || !f.published || f.factor === 1) return null
  const pct = Math.round((f.factor - 1) * 1000) / 10
  const [, plural] = POSITION_WORDS[pos]
  const startWords = pos === 'QB' ? `${lineup.qbDemand} quarterbacks (QB + superflex)` : `more ${plural}`
  return {
    kind: 'lineup',
    factor: f.factor,
    reason:
      `Lineup ${pct > 0 ? '+' : ''}${pct}%: in leagues that start ${bucket === 'high' ? startWords : `fewer ${plural}`} than usual ` +
      `(this one: ${lineup.label}), ${plural} trade ${Math.abs(pct)}% ${pct > 0 ? 'higher' : 'lower'} — ${f.note}`,
  }
}

/** Why a lineup that IS unusual got no adjustment, for the basis line. Null when nothing to say. */
export function lineupNote(table: LineupFactorTable | null, lineup: LineupProfile | null, positions: readonly string[]): string | null {
  if (!lineup) return null
  if (!table) return 'Lineup adjustments are not measured yet.'
  const missing: string[] = []
  for (const raw of new Set(positions.map((p) => String(p ?? '').toUpperCase()))) {
    if (!(raw in POSITION_WORDS)) continue
    const pos = raw as LineupPosition
    const band = table.usual[pos]
    if (!band) continue
    const d = lineupDemand(lineup, pos)
    const bucket = d < band.low ? 'low' : d > band.high ? 'high' : null
    if (!bucket) continue
    const f = table.factors.find((x) => x.position === pos && x.bucket === bucket)
    if (!f?.published) missing.push(`${POSITION_WORDS[pos][1]} (${f?.note ?? 'not measured'})`)
  }
  return missing.length ? `This lineup (${lineup.label}) is unusual for ${missing.join('; ')} — no lineup adjustment applied.` : null
}

// ─── The public board ───────────────────────────────────────────────────────────────────────────────

export type AfMarketMover = {
  playerId: string
  name: string
  position: string | null
  adjustmentPercent: number
  chartValue: number
  marketValue: number
  trades: number
  confidence: number
}

export type AfMarketBoard = {
  /** False when there is no fresh run to show — the UI then says so rather than showing old movers. */
  fresh: boolean
  generatedAt: string | null
  playersPriced: number
  rising: AfMarketMover[]
  falling: AfMarketMover[]
}

/** Pure ranking, so the board's rule is testable without a database. */
export function rankMarketMovers(rows: readonly AfMarketRow[], limit: number, now = new Date()): AfMarketBoard {
  const usable = rows.filter((r) => isApplicableMarketRow(r, now) && r.confidence >= 50)
  const toMover = (r: AfMarketRow): AfMarketMover => ({
    playerId: r.playerId,
    name: r.playerName ?? `Player ${r.playerId}`,
    position: r.position,
    adjustmentPercent: Math.round(r.adjustmentPercent * 10) / 10,
    chartValue: r.baseValue,
    marketValue: r.marketValue,
    trades: r.sampleSize,
    confidence: r.confidence,
  })
  // Ties broken by evidence: the same move on more trades is the stronger claim.
  const byMove = (dir: 1 | -1) => (a: AfMarketRow, b: AfMarketRow) =>
    dir * (b.adjustmentPercent - a.adjustmentPercent) || b.sampleSize - a.sampleSize
  const latest = rows.reduce<Date | null>((m, r) => (!m || r.generatedAt > m ? r.generatedAt : m), null)
  return {
    fresh: rows.length > 0,
    generatedAt: latest ? latest.toISOString() : null,
    playersPriced: rows.length,
    rising: usable.filter((r) => r.adjustmentPercent > 0).sort(byMove(1)).slice(0, limit).map(toMover),
    falling: usable.filter((r) => r.adjustmentPercent < 0).sort(byMove(-1)).slice(0, limit).map(toMover),
  }
}

/** The public "what the real trade market says" board for one book: biggest risers and fallers. */
export async function loadAfTradeMarketBoard(
  prisma: MarketDelegate,
  opts: { book: MarketBook; limit?: number; now?: Date },
): Promise<AfMarketBoard> {
  const now = opts.now ?? new Date()
  const limit = Math.max(1, Math.min(25, opts.limit ?? 8))
  const rows = await findRows(prisma, freshWhere(opts.book, now))
  return rankMarketMovers(rows, limit, now)
}

/**
 * How many distinct completed trades are on file. One trade is stored once per side, so this counts
 * `transactionId`, never rows. Cached in-process: it moves every few minutes and is shown as a
 * headline, not used to grade anything.
 */
let tradesOnFileCache: { at: number; value: number } | null = null
export async function countCompletedTradesOnFile(prisma: Pick<PrismaClient, '$queryRaw'>): Promise<number | null> {
  if (tradesOnFileCache && Date.now() - tradesOnFileCache.at < 30 * 60 * 1000) return tradesOnFileCache.value
  try {
    const rows = await prisma.$queryRaw<Array<{ n: bigint | number }>>`SELECT count(DISTINCT "transactionId") AS n FROM "LeagueTrade"`
    const value = Number(rows[0]?.n ?? 0)
    tradesOnFileCache = { at: Date.now(), value }
    return value
  } catch {
    return null
  }
}
