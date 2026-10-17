/**
 * POST /api/leagues/[leagueId]/survivor/tokens/grant
 * Commissioner-only: grant tokens to a player with a logged reason.
 * Tokens are in-game only — not real money.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import { logSurvivorAuditEntry } from '@/lib/survivor/auditEntry'

import { survivorHostGuard } from '@/lib/survivor/survivorHostGuard'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = params
  const denied = await survivorHostGuard(leagueId, userId)
  if (denied) return denied
  const gate = await assertLeagueCommissioner(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Commissioner only' }, { status: gate.status ?? 403 })

  let body: { targetUserId?: string; amount?: number; reason?: string; week?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { targetUserId, amount, reason, week } = body
  if (!targetUserId) return NextResponse.json({ error: 'targetUserId required' }, { status: 400 })
  if (typeof amount !== 'number' || amount <= 0) return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
  if (!reason) return NextResponse.json({ error: 'reason required for audit trail' }, { status: 400 })

  const player = await prisma.survivorPlayer.findFirst({
    where: { leagueId, userId: targetUserId },
    select: { id: true, tokenBalance: true, totalTokensEarned: true },
  })
  if (!player) return NextResponse.json({ error: 'Player not found in this league' }, { status: 404 })

  const updated = await prisma.survivorPlayer.update({
    where: { id: player.id },
    data: {
      tokenBalance: { increment: amount },
      totalTokensEarned: { increment: amount },
    },
    select: { tokenBalance: true, totalTokensEarned: true },
  })

  await logSurvivorAuditEntry({
    leagueId,
    week: week ?? 0,
    category: 'token',
    action: 'grant',
    data: {
      targetUserId,
      amount,
      reason,
      newBalance: updated.tokenBalance,
      commissionerUserId: userId,
    },
  })

  return NextResponse.json({ ok: true, newBalance: updated.tokenBalance, totalEarned: updated.totalTokensEarned })
}
