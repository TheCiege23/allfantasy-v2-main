import { Prisma, type PrismaClient } from '@prisma/client'

import { boardObservationsFor, computeBoardSportMarket, type BoardObservation, type BoardSportMarket, type BoardTradeRow } from './boardSportLearner'
import { structuralWeight } from './datedMarketLearner'

/**
 * The daily read for the board-valued sports' trade learning (`boardSportLearner.ts`): every stored non-NFL trade that
 * carries a saved context, one row per trade, grouped by sport, measured, and stored under one cache key. SHADOW — the
 * admin page shows it; nothing reads it into a grade. Read-only apart from that one cache row.
 * `TRADE_BOARD_LEARNER=off` stops it.
 */
export const TRADE_BOARD_LEARNER_ENV = 'TRADE_BOARD_LEARNER'
export const boardLearnerOn = (env: NodeJS.ProcessEnv = process.env) => String(env[TRADE_BOARD_LEARNER_ENV] ?? '').trim().toLowerCase() !== 'off'

export const BOARD_SPORT_MARKET_CACHE_KEY = 'af-trade-market:board-sports'
/** Newest first, bounded: the learner weights by age anyway, so the oldest rows count least. */
export const BOARD_TRADES_READ_LIMIT = 20_000

type Db = Pick<PrismaClient, 'leagueTrade' | 'sportsDataCache'>

export async function runBoardSportLearning(prisma: Db, opts: { now?: Date; env?: NodeJS.ProcessEnv } = {}): Promise<{ off?: true; markets: BoardSportMarket[]; written: boolean }> {
  if (!boardLearnerOn(opts.env)) return { off: true, markets: [], written: false }
  const now = opts.now ?? new Date()
  const rows = (await prisma.leagueTrade.findMany({
    where: { NOT: [{ sport: { in: ['nfl', 'NFL'] } }, { contextSnapshot: { equals: Prisma.DbNull } }] },
    orderBy: { tradeDate: 'desc' },
    take: BOARD_TRADES_READ_LIMIT,
    select: { transactionId: true, sport: true, week: true, tradeDate: true, partnerRosterId: true, playersGiven: true, playersReceived: true, contextSnapshot: true },
  })) as Array<BoardTradeRow & { sport: string; tradeDate: Date | null }>

  // Every trade is stored once per side; one row reads both sides.
  const seen = new Set<string>()
  const bySport = new Map<string, { obs: BoardObservation[]; trades: number; skipped: Record<string, number> }>()
  for (const r of rows) {
    if (!r.transactionId || seen.has(r.transactionId)) continue
    seen.add(r.transactionId)
    const sport = String(r.sport ?? '').trim().toUpperCase()
    if (!sport) continue
    const g = bySport.get(sport) ?? { obs: [], trades: 0, skipped: {} }
    bySport.set(sport, g)
    const read = boardObservationsFor(r, structuralWeight(r.tradeDate, now))
    if (Array.isArray(read)) {
      g.obs.push(...read)
      g.trades++
    } else g.skipped[read] = (g.skipped[read] ?? 0) + 1
  }
  const markets = [...bySport.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([sport, g]) => computeBoardSportMarket(sport, g.obs, now, { tradesRead: g.trades, skipped: g.skipped }))
  const data = { generatedAt: now.toISOString(), sports: markets }
  const expiresAt = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000)
  const written = await prisma.sportsDataCache
    .upsert({ where: { cacheKey: BOARD_SPORT_MARKET_CACHE_KEY }, create: { cacheKey: BOARD_SPORT_MARKET_CACHE_KEY, expiresAt, data: data as unknown as object }, update: { expiresAt, data: data as unknown as object } })
    .then(() => true, () => false)
  return { markets, written }
}
