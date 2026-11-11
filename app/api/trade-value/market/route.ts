/**
 * GET /api/trade-value/market — the AllFantasy trade market board, public.
 *
 * Biggest risers and fallers from the latest FRESH rebuild of player values from completed trades in
 * AllFantasy-connected leagues, plus how many trades are on file. DB-first: reads Postgres only.
 * No player, league or user data from any one league is exposed — only aggregates over all of them.
 */
import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { countCompletedTradesOnFile, loadAfTradeMarketBoard } from '@/lib/trade-market/afTradeMarketReads'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limitRaw = Number(url.searchParams.get('limit') ?? 8)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(25, Math.round(limitRaw))) : 8
  const [board, tradesOnFile] = await Promise.all([
    loadAfTradeMarketBoard(prisma, { limit }),
    countCompletedTradesOnFile(prisma),
  ])
  return NextResponse.json(
    { ...board, tradesOnFile, basis: 'Dynasty · 1QB · NFL — what managers actually paid, against the chart value' },
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=1800' } },
  )
}
