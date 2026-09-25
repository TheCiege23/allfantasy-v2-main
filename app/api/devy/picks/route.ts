import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { generatePickInventory } from '@/lib/devy/pickInventoryEngine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const rosterId = req.nextUrl.searchParams?.get('rosterId')?.trim()
  const type = req.nextUrl.searchParams?.get('type')?.trim()
  const seasonParam = req.nextUrl.searchParams?.get('season')

  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const cfg = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (!cfg) return NextResponse.json({ error: 'Devy league not configured' }, { status: 404 })

  const season = seasonParam ? Number(seasonParam) : cfg.season

  if (type === 'all') {
    const picks = await prisma.devyDraftPick.findMany({
      where: { leagueId },
      orderBy: [{ season: 'asc' }, { round: 'asc' }],
    })
    return NextResponse.json({ picks })
  }

  if (!rosterId) {
    return NextResponse.json({ error: 'rosterId required unless type=all' }, { status: 400 })
  }

  const inventory = await generatePickInventory(leagueId, season, 3)
  const filtered = inventory.years.map(y => ({
    ...y,
    rookiePicks: y.rookiePicks.filter(p => p.currentOwnerId === rosterId || p.originalOwnerId === rosterId),
    devyPicks: y.devyPicks.filter(p => p.currentOwnerId === rosterId || p.originalOwnerId === rosterId),
  }))
  return NextResponse.json({ inventory: { ...inventory, years: filtered } })
}

/**
 * 🛑 THIS ROUTE NO LONGER MOVES PICKS (2026-09-25).
 *
 * PATCH used to take `fromRosterId` and `toRosterId` from the request body, check only that the caller
 * was a MEMBER of the league, and call `processPickTrade` — which checks only that `fromRosterId` is
 * the pick's current owner, a fact any member can read from the GET above. Any member could move any
 * team's tradeable devy pick to any roster, including their own; and even a pick's owner could hand it
 * to a team that never agreed, which is a transfer, not a trade.
 *
 * Nothing in the app called it (every client request to /api/devy/picks is a GET), so the write path
 * is removed rather than patched. A pick changes hands through the trade engine
 * (`lib/league-trade-engine`), where both teams consent and the league's trade rules apply.
 */
export async function PATCH(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Picks are not moved here. Propose a trade instead — a pick changes hands when both teams accept.' },
    { status: 405, headers: { Allow: 'GET' } },
  )
}
