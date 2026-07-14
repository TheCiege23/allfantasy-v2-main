import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { reverseTradeFromExecutionSnapshot } from '@/lib/league-trade-engine/tradeReversalService'

export async function POST(request: Request, context: { params: Promise<{ proposalId: string }> }) {
  const session = await getServerSession(authOptions as never) as { user?: { id?: string } } | null
  const actorId = session?.user?.id
  if (!actorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { leagueId?: string; reason?: string; idempotencyKey?: string; organizationId?: string | null }
  const { proposalId } = await context.params
  if (!body.leagueId?.trim() || !body.reason?.trim() || !body.idempotencyKey?.trim()) return NextResponse.json({ error: 'leagueId, reason, and idempotencyKey are required' }, { status: 400 })
  try {
    const result = await reverseTradeFromExecutionSnapshot({ tradeId: proposalId, leagueId: body.leagueId.trim(), actorId, actorRole: 'commissioner', reason: body.reason, idempotencyKey: body.idempotencyKey.trim(), organizationId: body.organizationId ?? null })
    return NextResponse.json(result, { status: result.blocked ? 409 : 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Trade reversal failed'
    return NextResponse.json({ error: message }, { status: message.includes('authorization') ? 403 : 409 })
  }
}
