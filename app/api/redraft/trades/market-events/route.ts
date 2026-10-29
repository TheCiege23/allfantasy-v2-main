import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasLeagueCommissionerRights } from '@/lib/league/permissions'
import { assertLeagueMember } from '@/lib/league/league-access'

export const dynamic = 'force-dynamic'

/**
 * T3 commissioner-only read of the trade-market event ledger (QA + future analytics + transparency).
 * League-wide history is restricted to the commissioner / co-commissioner (and the league owner) —
 * commissioners can already see every trade, so this exposes nothing new. Returns a trimmed,
 * privacy-safe projection (no actorUserId, no raw payload internals beyond the asset/value summary).
 */
/** Owner, team commissioner / co-commissioner, or tournament co-commissioner (no team needed). */
function isCommissionerOrOwner(leagueId: string, userId: string): Promise<boolean> {
  return hasLeagueCommissionerRights(leagueId, userId)
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  if (!(await isCommissionerOrOwner(leagueId, userId))) {
    return NextResponse.json({ error: 'Commissioner or co-commissioner permission required' }, { status: 403 })
  }

  const limitRaw = Number(req.nextUrl.searchParams?.get('limit'))
  const take = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 100

  const rows = await prisma.redraftTradeMarketEvent.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      eventType: true,
      tradeProposalId: true,
      statusAtEvent: true,
      sport: true,
      grade: true,
      fairnessScore: true,
      confidenceScore: true,
      payload: true,
      createdAt: true,
    },
  })

  // Trim payload to the asset/value summary; never echo actorUserId or other internals.
  const events = rows.map((r) => {
    const p = (r.payload ?? {}) as { assets?: unknown; state?: { status?: string; voteCounts?: unknown } }
    return {
      id: r.id,
      eventType: r.eventType,
      tradeProposalId: r.tradeProposalId,
      status: r.statusAtEvent,
      sport: r.sport,
      grade: r.grade,
      fairnessScore: r.fairnessScore,
      confidenceScore: r.confidenceScore,
      assets: p.assets ?? null,
      voteCounts: p.state?.voteCounts ?? null,
      createdAt: r.createdAt,
    }
  })

  return NextResponse.json({ events })
}
