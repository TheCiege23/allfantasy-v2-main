import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { hasLeagueCommissionerRights } from '@/lib/league/permissions'
import { assertLeagueMember } from '@/lib/league/league-access'
import { assembleDiscoveryLeague } from '@/lib/trade-discovery/assembleRosters'
import { findPackages } from '@/lib/trade-discovery/redraftTradeDiscovery'
import { discoverySignals } from '@/lib/trade-block/redraftTradeBlockService'

export const dynamic = 'force-dynamic'

/** Owner, team commissioner / co-commissioner, or tournament co-commissioner (no team needed). */
function isCommissionerOrOwner(leagueId: string, userId: string): Promise<boolean> {
  return hasLeagueCommissionerRights(leagueId, userId)
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    leagueId?: string
    myRosterId?: string
    partnerRosterId?: string
    targetPlayerId?: string | null
    outgoingPlayerId?: string | null
  }
  const leagueId = body.leagueId?.trim()
  const myRosterId = body.myRosterId?.trim()
  const partnerRosterId = body.partnerRosterId?.trim()
  if (!leagueId || !myRosterId || !partnerRosterId) {
    return NextResponse.json({ error: 'leagueId, myRosterId, partnerRosterId required' }, { status: 400 })
  }
  if (myRosterId === partnerRosterId) return NextResponse.json({ error: 'Rosters must differ' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const league = await assembleDiscoveryLeague(leagueId)
  if (!league) return NextResponse.json({ error: 'No redraft season for league' }, { status: 404 })

  // Privacy: the "my" side must be the caller's own roster (or caller is commissioner/owner).
  const owner = league.ownerByRoster.get(myRosterId)
  if (owner !== userId && !(await isCommissionerOrOwner(leagueId, userId))) {
    return NextResponse.json({ error: 'You can only build packages from your own team' }, { status: 403 })
  }

  const myRoster = league.rosters.find((r) => r.rosterId === myRosterId)
  const partnerRoster = league.rosters.find((r) => r.rosterId === partnerRosterId)
  if (!myRoster || !partnerRoster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })

  // T8: attach native trade-block signals so package ideas can flag "on the trade block".
  const signals = await discoverySignals(leagueId, myRosterId)
  partnerRoster.blockPlayerIds = signals.blockPlayerIdsByRoster[partnerRosterId] ?? []
  myRoster.blockPlayerIds = signals.blockPlayerIdsByRoster[myRosterId] ?? []

  const faabSupported = (myRoster.faabBalance ?? 0) > 0 || (partnerRoster.faabBalance ?? 0) > 0
  const suggestedPackages = findPackages({
    myRoster,
    partnerRoster,
    sport: league.sport,
    faabSupported,
    draftPickTrading: league.draftPickTrading,
    targetPlayerId: body.targetPlayerId ?? null,
    outgoingPlayerId: body.outgoingPlayerId ?? null,
  })

  const warnings: string[] = []
  if (league.sport === 'NCAAF') warnings.push('NCAAF_LIMITED_DATA')
  if (!league.draftPickTrading) warnings.push('DRAFT_PICK_REFERENCE_ONLY')
  if (!signals.hasNativeBlock) warnings.push('TRADE_BLOCK_UNAVAILABLE')

  return NextResponse.json({
    suggestedPackages,
    warnings,
    canStartProposal: suggestedPackages.some((p) => p.canStartProposal),
    generatedAt: new Date().toISOString(),
  })
}
