/**
 * POST /api/leagues/[leagueId]/survivor/tokens/spend
 * Member: spend own tokens on an in-game advantage.
 * Prevents negative balances. Tokens are in-game only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import { logSurvivorAuditEntry } from '@/lib/survivor/auditEntry'

export const dynamic = 'force-dynamic'

// Advantages that are built and deliver. None yet: `buy_clue` took tokens and sent nothing, from
// the same balance an Exile return needs (see token-shop/route.ts). Add an advantage here only
// together with the code that delivers it.
const TOKEN_COSTS: Record<string, number> = {}

const PENDING_ADVANTAGES = new Set(['buy_clue', 'buy_vote_steal', 'buy_waiver_priority_boost', 'buy_protection', 'buy_extra_vote'])

export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status ?? 403 })

  let body: { advantage?: string; week?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { advantage, week } = body
  if (!advantage) return NextResponse.json({ error: 'advantage required' }, { status: 400 })

  if (PENDING_ADVANTAGES.has(advantage)) {
    return NextResponse.json({
      error: 'This advantage is not yet available.',
      pending: true,
      advantage,
    }, { status: 422 })
  }

  const cost = TOKEN_COSTS[advantage]
  if (cost === undefined) return NextResponse.json({ error: `Unknown advantage: ${advantage}` }, { status: 400 })

  const player = await prisma.survivorPlayer.findFirst({
    where: { leagueId, userId },
    select: { id: true, tokenBalance: true },
  })
  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 })
  if ((player.tokenBalance ?? 0) < cost) {
    return NextResponse.json({ error: 'Insufficient tokens', balance: player.tokenBalance, cost }, { status: 400 })
  }

  const updated = await prisma.survivorPlayer.update({
    where: { id: player.id },
    data: { tokenBalance: { decrement: cost } },
    select: { tokenBalance: true },
  })

  await logSurvivorAuditEntry({
    leagueId,
    week: week ?? 0,
    category: 'token',
    action: 'spend',
    data: { userId, advantage, cost, newBalance: updated.tokenBalance },
  })

  return NextResponse.json({ ok: true, advantage, cost, newBalance: updated.tokenBalance })
}
