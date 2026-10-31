import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import {
  listMyInterests,
  upsertInterest,
  resolveCallerContext,
  INTEREST_TYPES,
  type InterestType,
} from '@/lib/trade-block/redraftTradeBlockService'
import { recordRedraftTradeSignalEvent } from '@/lib/trade-market/redraftTradeMarketEvents'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden', code: 'forbidden' }, { status: gate.status })

  const ctx = await resolveCallerContext(leagueId, userId)
  // Privacy: a caller sees ONLY their own interests (private + public). No other manager's interests.
  const myInterests = ctx.rosterId ? await listMyInterests(ctx.rosterId) : []
  return NextResponse.json({ interests: myInterests })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    leagueId?: string
    targetRosterId?: string | null
    playerId?: string | null
    playerName?: string | null
    position?: string | null
    interestType?: string
    note?: string | null
    visibility?: 'private' | 'public'
  }
  const leagueId = body.leagueId?.trim()
  const interestType = body.interestType?.trim() as InterestType | undefined
  if (!leagueId || !interestType || !INTEREST_TYPES.includes(interestType)) {
    return NextResponse.json({ error: 'leagueId and a valid interestType required' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden', code: 'forbidden' }, { status: gate.status })

  const ctx = await resolveCallerContext(leagueId, userId)
  if (!ctx.rosterId || !ctx.seasonId) return NextResponse.json({ error: 'You do not have a roster in this league', code: 'no_roster' }, { status: 403 })

  const interest = await upsertInterest({
    leagueId,
    fromRosterId: ctx.rosterId,
    targetRosterId: body.targetRosterId ?? null,
    playerId: body.playerId ?? null,
    playerName: body.playerName ?? null,
    position: body.position ?? null,
    interestType,
    note: body.note ?? null,
    visibility: body.visibility === 'public' ? 'public' : 'private',
  })

  await recordRedraftTradeSignalEvent({
    leagueId,
    seasonId: ctx.seasonId,
    refId: interest.id,
    eventType: 'trade_interest_added',
    actorUserId: userId,
    payload: { interestType, playerId: interest.playerId, visibility: interest.visibility },
  })

  return NextResponse.json({ interest })
}
