/**
 * GET /api/leagues/[leagueId]/survivor/token-shop
 * Returns the token shop catalog: only advantages that are built and deliver something.
 *
 * 🛑 NONE DOES YET (2026-10-27). `buy_clue` was listed as available and `tokens/spend` charged for it,
 * but nothing ever sent a clue: the tokens left and nothing arrived. Those tokens are the same
 * balance a manager on Exile needs to come back. So every item is pending until it delivers, and
 * the shop lists nothing a manager can spend on.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const TOKEN_SHOP_CATALOG = [
  { id: 'buy_clue', label: 'Idol Clue', cost: 2, status: 'pending', description: 'Receive a clue to a hidden idol location.' },
  { id: 'buy_extra_vote', label: 'Extra Vote', cost: 4, status: 'pending', description: 'Cast an additional vote at tribal council. (Phase 3)' },
  { id: 'buy_vote_steal', label: 'Vote Steal', cost: 5, status: 'pending', description: 'Take another player\'s vote for one council. (Phase 3)' },
  { id: 'buy_waiver_priority_boost', label: 'Waiver Priority Boost', cost: 3, status: 'pending', description: 'Jump to priority waiver pick for one week. (Phase 3)' },
  { id: 'buy_protection', label: 'Challenge Protection', cost: 6, status: 'pending', description: 'Sit out a challenge without penalty. (Phase 3)' },
]

export async function GET(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status ?? 403 })

  const player = await prisma.survivorPlayer.findFirst({
    where: { leagueId, userId },
    select: { tokenBalance: true },
  })

  return NextResponse.json({
    // Unbuilt items are hidden, not shown as for sale.
    catalog: TOKEN_SHOP_CATALOG.filter(item => item.status === 'available'),
    balance: player?.tokenBalance ?? 0,
    shopStatus: 'pending',
    shopNote: 'The token shop opens once its advantages are built. Nothing can be bought yet.',
  })
}
