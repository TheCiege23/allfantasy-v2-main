import type { PrismaClient } from '@prisma/client'

import type { LeagueValueAdjustment } from '@/lib/trade-value/leagueTradeValue'
import { COMPLETED_SOURCE_VERSION } from './completedTradeObservations'

/**
 * DB-FIRST READS of the AllFantasy trade market — player values derived from trades that actually
 * happened in AllFantasy-connected leagues (`completedTradeObservations.ts` writes them; the daily
 * `/api/cron/af-market-values` job keeps them current). Request paths read here; nothing here calls a
 * provider.
 *
 * 🛑 A STALE ROW IS NOT A MARKET. The table holds whatever the last successful run wrote, and the run
 * refuses to write when the population is not centred (`isCentred`). If it keeps refusing, the rows
 * stop moving while the chart underneath them keeps moving every hour — so an adjustment measured
 * against an old chart would be applied to a new one. Rows older than `AF_MARKET_MAX_AGE_DAYS` are
 * therefore ignored, not served: the grade falls back to the chart alone and says nothing about a
 * trade market it no longer has evidence for.
 *
 * ⚠ WHICH CHARTS IT APPLIES TO, AND WHY QBs ARE LEFT OUT. The observations are priced against the
 * DYNASTY · 1QB board, so the adjustment is only meaningful on that board. Quarterbacks are excluded
 * because the trade population mixes superflex and 1QB leagues without telling them apart: a QB
 * routinely bought at superflex prices would read as "rising" on the 1QB board for a reason that has
 * nothing to do with his market. Every other position trades at broadly the same price in both.
 */

export const AF_MARKET_SPORT = 'NFL'
export const AF_MARKET_CONCEPT = 'dynasty'
export const AF_MARKET_MAX_AGE_DAYS = 21
/** Positions the adjustment is never applied to — see the header. */
export const AF_MARKET_EXCLUDED_POSITIONS: ReadonlySet<string> = new Set(['QB'])

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

async function findRows(prisma: MarketDelegate, where: Record<string, unknown>): Promise<AfMarketRow[]> {
  try {
    const rows = await prisma.allFantasyMarketPlayerValue.findMany({ where, select: SELECT })
    return Array.isArray(rows) ? (rows as AfMarketRow[]) : []
  } catch {
    return []
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

function freshSince(now: Date): Date {
  return new Date(now.getTime() - AF_MARKET_MAX_AGE_DAYS * 24 * 60 * 60 * 1000)
}

function freshWhere(now: Date) {
  return {
    sport: AF_MARKET_SPORT,
    leagueConcept: AF_MARKET_CONCEPT,
    sourceVersion: COMPLETED_SOURCE_VERSION,
    published: true,
    generatedAt: { gte: freshSince(now) },
  }
}

/** Is a row usable as an adjustment on a grade? Pure, so the rule is testable without a database. */
export function isApplicableMarketRow(row: Pick<AfMarketRow, 'position' | 'adjustmentPercent' | 'sampleSize' | 'generatedAt'>, now = new Date()): boolean {
  if (!Number.isFinite(row.adjustmentPercent) || row.adjustmentPercent === 0) return false
  if (row.sampleSize < 5) return false
  if (row.generatedAt.getTime() < freshSince(now).getTime()) return false
  const pos = String(row.position ?? '').trim().toUpperCase()
  return !AF_MARKET_EXCLUDED_POSITIONS.has(pos)
}

/** The visible grade adjustment one market row produces. */
export function tradeMarketAdjustment(row: Pick<AfMarketRow, 'adjustmentPercent' | 'sampleSize'>): LeagueValueAdjustment {
  const pct = Math.round(row.adjustmentPercent * 10) / 10
  const signed = `${pct > 0 ? '+' : ''}${pct}%`
  return {
    kind: 'tradeMarket',
    factor: 1 + pct / 100,
    reason: `AllFantasy trade market ${signed}: what managers actually paid for him across ${row.sampleSize} completed trades in AllFantasy-connected leagues`,
  }
}

/**
 * Fresh, applicable market rows for these Sleeper ids. Empty map on any read failure — the grade
 * then runs on the chart alone, which is exactly what it did before this layer existed.
 */
export async function loadAfTradeMarketRows(
  prisma: MarketDelegate,
  sleeperIds: readonly string[],
  now = new Date(),
): Promise<Map<string, AfMarketRow>> {
  const ids = [...new Set(sleeperIds.map((s) => s.trim()).filter((s) => /^\d+$/.test(s)))]
  const out = new Map<string, AfMarketRow>()
  if (ids.length === 0) return out
  const rows = await findRows(prisma, { ...freshWhere(now), playerId: { in: ids } })
  for (const r of rows) if (isApplicableMarketRow(r, now)) out.set(r.playerId, r)
  return out
}

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

/** The public "what the real trade market says" board: biggest risers and fallers from a FRESH run. */
export async function loadAfTradeMarketBoard(
  prisma: MarketDelegate,
  opts: { limit?: number; now?: Date } = {},
): Promise<AfMarketBoard> {
  const now = opts.now ?? new Date()
  const limit = Math.max(1, Math.min(25, opts.limit ?? 8))
  const rows = await findRows(prisma, freshWhere(now))
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
