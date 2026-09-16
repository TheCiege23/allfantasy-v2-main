import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { cancelAfLeagueTrade, getAfLeagueTrade } from '@/lib/league-trade-engine/tradeService'
import { prisma } from '@/lib/prisma'
import { isSportsDataEnabled } from '@/lib/sports-evidence/gates'
import { CertifiedTradeIntegrationService, extractTradePlayerRefs, type CertifiedScheduleDescription } from '@/lib/sports-evidence/tradeIntegration'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'
import { evaluateCanonicalTrade, type CanonicalTradeEvaluation } from '@/lib/decision-os/trade/canonicalEvaluator'
import { afTradeItemToAssetSummary } from '@/lib/decision-os/trade/afTradeItemAsset'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'

export const dynamic = 'force-dynamic'

/**
 * What an offer does to the VIEWER's lineup, computed only when asked for.
 *
 * ── ⚠ WHY HERE, AND WHY ON DEMAND ────────────────────────────────────────────────────────────
 *
 * The trades panel evaluates every offer in a list render; computing roster impact there would
 * enrich a whole roster PER OFFER on every load. This route is already what the Inbox fetches when
 * a manager opens ONE offer (to build a counter), so impact rides it behind `?include=rosterImpact`
 * and is paid for only by the person looking. No new route — this repo does not add them.
 *
 * ⚠ THE VIEWER IS RESOLVED AMONG THE TWO PARTICIPANTS ONLY. "What does this do to MY lineup" has no
 * answer for a commissioner viewing someone else's offer, and resolving a roster league-wide would
 * quietly compute impact for whichever team the caller happens to own — a real number about the
 * wrong trade.
 */
export type RosterImpactResponse =
  | { available: true; impact: NonNullable<CanonicalTradeEvaluation['rosterImpact']> }
  | { available: false; reason: string }

async function resolveRosterImpact(args: {
  leagueId: string
  userId: string
  trade: NonNullable<Awaited<ReturnType<typeof getAfLeagueTrade>>>
}): Promise<RosterImpactResponse> {
  const { leagueId, userId, trade } = args
  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { sleeperUserId: true } })
    .catch(() => null)
  const candidateIds = [userId, profile?.sleeperUserId].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )
  const viewerRoster = await prisma.roster
    .findFirst({
      where: {
        leagueId,
        platformUserId: { in: candidateIds },
        id: { in: [trade.proposerRosterId, trade.receiverRosterId] },
      },
      select: { id: true },
    })
    .catch(() => null)
  if (!viewerRoster) {
    return { available: false, reason: 'you are not a party to this trade, so it does not change your lineup' }
  }

  const world = await resolveCanonicalWorld(leagueId).catch(() => null)
  if (!world) return { available: false, reason: 'the league could not be read' }

  const evaluation = await evaluateCanonicalTrade(
    {
      leagueId,
      proposalId: trade.id,
      proposerRosterId: trade.proposerRosterId,
      receiverRosterId: trade.receiverRosterId,
      viewerRosterId: viewerRoster.id,
      assets: (trade.items ?? []).map(afTradeItemToAssetSummary),
      currentSeason: world.league.season ?? undefined,
      includeRosterImpact: true,
    },
    { resolveWorld: async () => world },
  )

  /*
   * ⚠ `null` IS "ASKED FOR, COULD NOT BE PRODUCED" — typically a league with no known starting
   * slots. Reported as unavailable WITH that reason rather than as an empty impact, because an
   * empty impact renders as "no change", and "no change" is a claim.
   */
  if (!evaluation.rosterImpact) {
    return { available: false, reason: "this league's starting lineup could not be determined" }
  }
  return { available: true, impact: evaluation.rosterImpact }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; tradeId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId, tradeId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const trade = await getAfLeagueTrade(leagueId, tradeId)
  if (!trade) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Gated, informational certified schedule context for the traded players. Analysis surface only — it never
  // changes valuation, fairness, recommendation, or roster reconstruction. Wrapped so it can never fail the read.
  let sportsContext: CertifiedScheduleDescription | undefined
  if (isSportsDataEnabled('trade')) {
    try {
      const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } })
      if (league && String(league.sport ?? 'NFL').toUpperCase() === 'NFL') {
        const refs = extractTradePlayerRefs((trade.items ?? []).map((i) => ({ itemType: i.itemType, itemReference: i.itemReference })))
        sportsContext = await new CertifiedTradeIntegrationService().describeTradeSportsContext({
          season: String(league.season ?? new Date().getFullYear()),
          week: String(weekFromLeagueSettingsForLineup(league.settings)),
          players: refs,
        })
      }
    } catch {
      sportsContext = undefined
    }
  }

  /*
   * Opt-in, and wrapped exactly like `sportsContext` above so it can never fail the read. The
   * Inbox's counter flow fetches this same route WITHOUT the param and must not pay for, or be
   * broken by, a lineup computation it never asked for.
   */
  let rosterImpact: RosterImpactResponse | undefined
  if (req.nextUrl?.searchParams?.get('include') === 'rosterImpact') {
    try {
      rosterImpact = await resolveRosterImpact({ leagueId, userId, trade })
    } catch {
      rosterImpact = { available: false, reason: 'the lineup effect could not be computed' }
    }
  }

  /*
   * ⚠ KEPT ON ONE LINE BECAUSE A GUARD READS THIS SOURCE. `__tests__/fantasy-os/sports-data-trade`
   * asserts `return NextResponse.json({ trade, ...(sportsContext` literally, to pin that `trade` is
   * passed through unchanged with context as a SIBLING. Reformatting this across lines broke that
   * assertion without changing behaviour — the fix is to keep the shape it encodes, not to loosen a
   * guard someone else wrote so it suits the formatting. `rosterImpact` is a further sibling.
   */
  return NextResponse.json({ trade, ...(sportsContext ? { sportsContext } : {}), ...(rosterImpact ? { rosterImpact } : {}) })
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; tradeId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId, tradeId } = await ctx.params
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  try {
    await cancelAfLeagueTrade({ tradeId, leagueId, userId })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
