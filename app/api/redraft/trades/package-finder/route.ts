import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { hasLeagueCommissionerRights } from '@/lib/league/permissions'
import { assertLeagueMember } from '@/lib/league/league-access'
import { assembleDiscoveryLeague } from '@/lib/trade-discovery/assembleRosters'
import { findPackages, findPartners } from '@/lib/trade-discovery/redraftTradeDiscovery'
import { discoverySignals } from '@/lib/trade-block/redraftTradeBlockService'
import { resolveCoreDepth } from '@/lib/core-app/corePaywall'
import { finderTaste } from '@/lib/trade-finder/finderTaste'
import { createLeagueTradeGrader, gradeDeal } from '@/lib/decision-os/trade/leagueTradeGrader'
import { attachPackageGrades } from '@/lib/trade-discovery/packageGrades'

export const dynamic = 'force-dynamic'

/** Packages returned, after THE grade re-ranks them. */
const PACKAGES_SHOWN = 5
/** Packages generated and graded — more than are shown, so the grade, not the finder, picks the five. */
const PACKAGES_GRADED = 8
const GRADE_BUDGET_MS = 8_000

/** Owner, team commissioner / co-commissioner, or tournament co-commissioner (no team needed). */
function isCommissionerOrOwner(leagueId: string, userId: string): Promise<boolean> {
  return hasLeagueCommissionerRights(leagueId, userId)
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string; email?: string | null } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })

  /*
   * 🛑 THE TRADE FINDER RULE (owner's decision 2026-11-27; gating audit H3): AF Pro and AF Supreme, read
   * from the same `trade_finder` depth as the /core finder and Partner Match. The redraft Trade Center's
   * partner search and package finder were free to any league member.
   *
   * 🛑 FREE TASTE (owner, 2026-11-27): without the plan, packages are built ONLY for the one partner the
   * free discovery shows (the top match — recomputed below, never trusted from the body), and only the
   * top package is sent, plus `lock`. Any other partner is refused.
   */
  const finderAccess = await resolveCoreDepth(userId, 'trade_finder', { email: session?.user?.email ?? null })

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
  if (myRosterId === partnerRosterId) return NextResponse.json({ error: 'Rosters must differ', code: 'rosters_must_differ' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden', code: 'forbidden' }, { status: gate.status })

  const league = await assembleDiscoveryLeague(leagueId)
  if (!league) return NextResponse.json({ error: 'No redraft season for league', code: 'no_season' }, { status: 404 })

  // Privacy: the "my" side must be the caller's own roster (or caller is commissioner/owner).
  const owner = league.ownerByRoster.get(myRosterId)
  if (owner !== userId && !(await isCommissionerOrOwner(leagueId, userId))) {
    return NextResponse.json({ error: 'You can only build packages from your own team', code: 'own_team_only' }, { status: 403 })
  }

  const myRoster = league.rosters.find((r) => r.rosterId === myRosterId)
  const partnerRoster = league.rosters.find((r) => r.rosterId === partnerRosterId)
  if (!myRoster || !partnerRoster) return NextResponse.json({ error: 'Roster not found', code: 'roster_not_found' }, { status: 404 })

  // T8: attach native trade-block signals so package ideas can flag "on the trade block".
  const signals = await discoverySignals(leagueId, myRosterId)
  partnerRoster.blockPlayerIds = signals.blockPlayerIdsByRoster[partnerRosterId] ?? []
  myRoster.blockPlayerIds = signals.blockPlayerIdsByRoster[myRosterId] ?? []

  if (!finderAccess.unlocked) {
    // The same match the free discovery shows, from the same inputs.
    for (const r of league.rosters) r.blockPlayerIds = signals.blockPlayerIdsByRoster[r.rosterId] ?? []
    const top = findPartners({
      myRoster,
      otherRosters: league.rosters,
      sport: league.sport,
      myInterest: { playerIds: signals.myInterestPlayerIds, positions: signals.myInterestPositions, hasPrivate: true },
      hasNativeBlock: signals.hasNativeBlock,
    })[0]
    if (!top || top.rosterId !== partnerRosterId) {
      return NextResponse.json(
        {
          error: 'Premium feature',
          code: 'feature_not_entitled',
          message: `Package ideas for every partner are part of ${finderAccess.planName}.`,
          requiredPlan: finderAccess.planName,
          upgradePath: finderAccess.upgradePath,
        },
        { status: 403 },
      )
    }
  }

  // ONE grader for the league, loading while the packages are generated. Membership is checked above.
  const grader = createLeagueTradeGrader({ leagueId, userId }).catch(() => null)

  const faabSupported = (myRoster.faabBalance ?? 0) > 0 || (partnerRoster.faabBalance ?? 0) > 0
  const generated = findPackages({
    myRoster,
    partnerRoster,
    sport: league.sport,
    faabSupported,
    draftPickTrading: league.draftPickTrading,
    targetPlayerId: body.targetPlayerId ?? null,
    outgoingPlayerId: body.outgoingPlayerId ?? null,
    max: PACKAGES_GRADED,
  })

  /*
   * 🛑 THE GRADE ON EVERY PACKAGE (2026-11-26, lib/trade-discovery/packageGrades.ts). The finder's
   * values generate the packages; the band, totals, startability and order are the one grader's.
   * Roster need is priced only when the caller IS the sending roster — a commissioner building from
   * another team gets that team's deal on league value, never their own roster's need.
   */
  const suggestedPackages = await attachPackageGrades({
    packages: generated,
    grade: async (give, get) => gradeDeal(await grader, { give, get, viewerSide: owner === userId }),
    faabSupported,
    sport: league.sport,
    max: PACKAGES_SHOWN,
    budgetMs: GRADE_BUDGET_MS,
  })

  const warnings: string[] = []
  if (league.sport === 'NCAAF') warnings.push('NCAAF_LIMITED_DATA')
  if (!league.draftPickTrading) warnings.push('DRAFT_PICK_REFERENCE_ONLY')
  if (!signals.hasNativeBlock) warnings.push('TRADE_BLOCK_UNAVAILABLE')

  const taste = finderTaste(suggestedPackages, finderAccess)
  return NextResponse.json({
    suggestedPackages: taste.items,
    lock: taste.lock,
    warnings,
    canStartProposal: taste.items.some((p) => p.canStartProposal),
    generatedAt: new Date().toISOString(),
  })
}
