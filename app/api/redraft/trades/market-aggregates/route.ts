import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasLeagueCommissionerRights } from '@/lib/league/permissions'
import { assertLeagueMember } from '@/lib/league/league-access'
import { computeMarketAggregates, type MarketEventInput } from '@/lib/trade-market/redraftTradeMarketAggregates'

export const dynamic = 'force-dynamic'

const ALLOWED_SCOPES = new Set(['league', 'sport', 'sport_concept'])

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

  let scope = req.nextUrl.searchParams?.get('scope')?.trim() || 'league'
  if (!ALLOWED_SCOPES.has(scope)) scope = 'league'

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
  // League-wide analytics (any scope) require commissioner/owner of the requesting league.
  if (!(await isCommissionerOrOwner(leagueId, userId))) {
    return NextResponse.json({ error: 'Commissioner or co-commissioner permission required' }, { status: 403 })
  }

  // Resolve this league's sport for the broader scopes.
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, select: { sport: true } })
  const sport = season?.sport ?? null

  const where =
    scope === 'league' || !sport
      ? { leagueId }
      : { sport } // sport + sport_concept both filter by sport; concept refined in-memory below

  const rows = await prisma.redraftTradeMarketEvent.findMany({
    where,
    select: { eventType: true, tradeProposalId: true, grade: true, fairnessScore: true, confidenceScore: true, payload: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  })

  let events = rows as unknown as MarketEventInput[]
  if (scope === 'sport_concept') {
    events = events.filter((e) => {
      const ctx = (e.payload as { context?: { leagueType?: string } } | null)?.context
      return ctx?.leagueType === 'redraft'
    })
  }

  const aggregates = computeMarketAggregates(events)

  // If we fell back to league (no sport resolved) when a broader scope was requested, report it.
  const effectiveScope = (scope !== 'league' && !sport) ? 'league' : scope

  return NextResponse.json({
    scope: effectiveScope,
    requestedScope: scope,
    ...aggregates,
    generatedAt: new Date().toISOString(),
  })
}
