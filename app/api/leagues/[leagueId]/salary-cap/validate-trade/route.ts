/**
 * POST: Validate trade for salary cap (both rosters legal). PROMPT 339.
 * Call before accepting any player-for-player trade in a salary cap league.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isSalaryCapLeague } from '@/lib/salary-cap/SalaryCapLeagueConfig'
import { validateTradeCap } from '@/lib/salary-cap/SalaryCapTradeValidator'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isCap = await isSalaryCapLeague(leagueId)
  if (!isCap) return NextResponse.json({ error: 'Not a salary cap league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const { fromRosterId, toRosterId, movingToReceiver = [], movingToSender = [] } = body
  if (!fromRosterId || !toRosterId || !Array.isArray(movingToReceiver) || !Array.isArray(movingToSender)) {
    return NextResponse.json(
      { error: 'Body must include fromRosterId, toRosterId, movingToReceiver[], movingToSender[]' },
      { status: 400 }
    )
  }
  const validLine = (line: unknown) => {
    if (!line || typeof line !== 'object') return false
    const asset = line as Record<string, unknown>
    return typeof asset.playerId === 'string' && asset.playerId.trim().length > 0
      && (asset.contractId == null || typeof asset.contractId === 'string')
  }
  if (![...movingToReceiver, ...movingToSender].every(validLine)) {
    return NextResponse.json({ error: 'Every traded contract must identify a player' }, { status: 400 })
  }

  const input = {
    fromRosterId: String(fromRosterId),
    toRosterId: String(toRosterId),
    movingToReceiver: movingToReceiver.map((m: { contractId?: string; playerId: string; salary: number }) => ({
      contractId: m.contractId,
      playerId: String(m.playerId),
      salary: Number(m.salary) || 0,
    })),
    movingToSender: movingToSender.map((m: { contractId?: string; playerId: string; salary: number }) => ({
      contractId: m.contractId,
      playerId: String(m.playerId),
      salary: Number(m.salary) || 0,
    })),
  }
  const result = await validateTradeCap(leagueId, input)
  return NextResponse.json(result)
}
