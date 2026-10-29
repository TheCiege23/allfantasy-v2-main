import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { hasLeagueCommissionerRights } from '@/lib/league/permissions'
import { assertLeagueMember } from '@/lib/league/league-access'
import { assembleDiscoveryLeague } from '@/lib/trade-discovery/assembleRosters'
import { findPartners } from '@/lib/trade-discovery/redraftTradeDiscovery'
import { discoverySignals } from '@/lib/trade-block/redraftTradeBlockService'

export const dynamic = 'force-dynamic'

/** Owner, team commissioner / co-commissioner, or tournament co-commissioner (no team needed). */
function isCommissionerOrOwner(leagueId: string, userId: string): Promise<boolean> {
  return hasLeagueCommissionerRights(leagueId, userId)
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const rosterId = req.nextUrl.searchParams?.get('rosterId')?.trim()
  if (!leagueId || !rosterId) return NextResponse.json({ error: 'leagueId and rosterId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const league = await assembleDiscoveryLeague(leagueId)
  if (!league) return NextResponse.json({ error: 'No redraft season for league' }, { status: 404 })

  // Privacy: a manager may only run discovery for their OWN roster; commissioners/owner may run any.
  const owner = league.ownerByRoster.get(rosterId)
  if (owner !== userId && !(await isCommissionerOrOwner(leagueId, userId))) {
    return NextResponse.json({ error: 'You can only discover trades for your own team' }, { status: 403 })
  }

  const myRoster = league.rosters.find((r) => r.rosterId === rosterId)
  if (!myRoster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })

  // T8: native trade-block + own-interest signals (privacy-safe).
  const signals = await discoverySignals(leagueId, rosterId)
  for (const r of league.rosters) r.blockPlayerIds = signals.blockPlayerIdsByRoster[r.rosterId] ?? []
  const partners = findPartners({
    myRoster,
    otherRosters: league.rosters,
    sport: league.sport,
    myInterest: { playerIds: signals.myInterestPlayerIds, positions: signals.myInterestPositions, hasPrivate: true },
    hasNativeBlock: signals.hasNativeBlock,
  })

  return NextResponse.json({
    summary: {
      myNeeds: partners[0]?.myNeeds ?? [],
      mySurpluses: partners[0]?.mySurpluses ?? [],
      partnerCount: partners.length,
      sport: league.sport,
    },
    partners,
    warnings: league.sport === 'NCAAF' ? ['NCAAF_LIMITED_DATA'] : [],
    generatedAt: new Date().toISOString(),
  })
}
