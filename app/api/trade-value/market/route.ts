/**
 * GET /api/trade-value/market — the AllFantasy trade market board, public.
 *
 * Biggest risers and fallers from the latest FRESH rebuild of player values from completed trades in
 * AllFantasy-connected leagues, for ONE format: `?format=dynasty|redraft&qb=sf|1qb` (default dynasty
 * superflex — the most common format among this season's trades). DB-first: reads Postgres only. No
 * player, league or user data from any one league is exposed — only aggregates over all of them.
 */
import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { bookLabel, countCompletedTradesOnFile, loadAfTradeMarketBoard } from '@/lib/trade-market/afTradeMarketReads'
import type { MarketBook } from '@/lib/trade-market/formatMarkets'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limitRaw = Number(url.searchParams.get('limit') ?? 8)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(25, Math.round(limitRaw))) : 8
  const book: MarketBook = {
    format: url.searchParams.get('format')?.toLowerCase() === 'redraft' ? 'REDRAFT' : 'DYNASTY',
    qbFormat: url.searchParams.get('qb')?.toLowerCase() === '1qb' ? 'ONE_QB' : 'SUPERFLEX',
  }
  const [board, tradesOnFile] = await Promise.all([
    loadAfTradeMarketBoard(prisma, { book, limit }),
    countCompletedTradesOnFile(prisma),
  ])
  return NextResponse.json(
    { ...board, tradesOnFile, book, basis: `${bookLabel(book)} · NFL — what managers actually paid in this format, against its chart value` },
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=1800' } },
  )
}
