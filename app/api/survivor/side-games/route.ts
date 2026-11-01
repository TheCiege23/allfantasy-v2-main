import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  buySurvivorShopItem,
  cashOutTokenPool,
  loadSurvivorSideGameView,
  placeExileTeamBid,
  placeSurvivorAuctionBid,
  reviveSurvivorPoolEntry,
  submitSurvivorPoolPick,
  submitTokenPoolPick,
} from '@/lib/survivor/survivorSideGameService'

export const dynamic = 'force-dynamic'

/**
 * Exile Island and the side games, for one castaway: the Token Pool (exiles), the Survivor Pool
 * (castaways on the island), Auction Week bids, the token shop and Exile team bids.
 *
 * GET  ?leagueId=…  → the caller's OWN view (their picks, bids and balances; never anyone else's).
 * POST { leagueId, action, … } → one action. Every rule is enforced in the service; a refusal is a
 * 4xx with a message in the league's language.
 */

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function GET(req: NextRequest) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  const view = await loadSurvivorSideGameView(leagueId, userId)
  if (!view) return NextResponse.json({ error: 'Not a castaway in this Survivor league.' }, { status: 404 })
  return NextResponse.json(view)
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const leagueId = str(body.leagueId, 64)
  const action = str(body.action, 40)
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  let result: { ok: boolean; status?: number; error?: string } & Record<string, unknown>
  switch (action) {
    case 'token_pool_pick':
    case 'pool_pick': {
      const gameKey = str(body.gameKey, 120)
      const teamKey = str(body.teamKey, 60)
      if (!gameKey || !teamKey) return NextResponse.json({ error: 'gameKey and teamKey required' }, { status: 400 })
      result = action === 'token_pool_pick'
        ? await submitTokenPoolPick({ leagueId, userId, gameKey, teamKey })
        : await submitSurvivorPoolPick({ leagueId, userId, gameKey, teamKey })
      break
    }
    case 'token_pool_cash_out':
      result = await cashOutTokenPool({ leagueId, userId })
      break
    case 'pool_revive':
      result = await reviveSurvivorPoolEntry({ leagueId, userId, actorUserId: userId })
      break
    case 'auction_bid': {
      const auctionId = str(body.auctionId, 64)
      const itemId = str(body.itemId, 32)
      if (!auctionId || !itemId || typeof body.amount !== 'number') return NextResponse.json({ error: 'auctionId, itemId and amount required' }, { status: 400 })
      result = await placeSurvivorAuctionBid({ leagueId, userId, auctionId, itemId, amount: body.amount })
      break
    }
    case 'shop_buy': {
      const itemId = str(body.itemId, 32)
      const requestId = str(body.requestId, 64)
      if (!itemId || !requestId) return NextResponse.json({ error: 'itemId and requestId required' }, { status: 400 })
      result = await buySurvivorShopItem({ leagueId, userId, itemId, requestId })
      break
    }
    case 'exile_bid': {
      const team = str(body.team, 60)
      if (!team || typeof body.amount !== 'number') return NextResponse.json({ error: 'team and amount required' }, { status: 400 })
      result = await placeExileTeamBid({ leagueId, userId, team, amount: body.amount })
      break
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  return NextResponse.json(result)
}
