import 'server-only'
import { prisma } from '@/lib/prisma'
import { valuePositionsAgree } from '@/lib/league-values/playerValueIdentity'
import { loadAfTradeMarketRows } from '@/lib/trade-market/afTradeMarketReads'
import type { MarketBook } from '@/lib/trade-market/formatMarkets'

export async function loadAfNflMarketQuote(args: {
  book: MarketBook; sleeperId?: string | null; name: string; position?: string | null; allowNameLookup: boolean
}) {
  let id = args.sleeperId
  if (!id && args.allowNameLookup && args.name.trim()) {
    const matches = await prisma.playerIdentityMap.findMany({
      where: { sport: 'NFL', canonicalName: { equals: args.name.trim(), mode: 'insensitive' }, sleeperId: { not: null } },
      select: { sleeperId: true, position: true },
    })
    const verified = matches.filter(row => valuePositionsAgree(args.position, row.position))
    if (verified.length === 1) id = verified[0]!.sleeperId
  }
  if (!id) return null
  const quote = (await loadAfTradeMarketRows(prisma, [id], args.book, new Date(), true)).get(id)
  return quote && valuePositionsAgree(args.position, quote.position) ? quote : null
}
