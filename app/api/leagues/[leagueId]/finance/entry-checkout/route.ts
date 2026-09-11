import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getStripeClient } from '@/lib/stripe-client'
import { getBaseUrl } from '@/lib/get-base-url'
import { resolveLeagueMembership } from '@/lib/league-access'
import { prisma } from '@/lib/prisma'
import { getOrCreateLeagueFinance, resolveSeasonForLeague } from '@/lib/league-finance/leagueFinanceService'
import {
  assertLeagueEntryFeeProcessingEnabled,
  isLeagueEntryFeeDisabledError,
} from '@/lib/monetization/leagueEntryFeeKillSwitch'
import {
  assertNoLeagueSettlementIntent,
  isMonetizationComplianceError,
} from '@/lib/monetization/compliance-guardrails'

export const dynamic = 'force-dynamic'

/**
 * Stripe Checkout for league entry fee (metadata purchaseType = league_entry_fee; webhook credits dues).
 *
 * 🛑 DISABLED BY DEFAULT — see `lib/monetization/leagueEntryFeeKillSwitch.ts`.
 * This route contradicts the published disclaimer and terms, and it was the one
 * checkout route in the app that never called `assertNoLeagueSettlementIntent`
 * despite that guard explicitly matching `entry_fee`.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  /*
   * Refused BEFORE auth, the league lookup, and any Stripe call.
   *
   * Ordering matters: a disabled feature must not be a league-existence oracle,
   * must not cost a Stripe round trip, and must answer identically to everyone.
   */
  try {
    assertLeagueEntryFeeProcessingEnabled()
  } catch (e) {
    if (isLeagueEntryFeeDisabledError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode })
    }
    throw e
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params

  /*
   * 🛑 THIS CREATED A STRIPE CHECKOUT SESSION FOR ANY LEAGUE A SIGNED-IN
   * USER NAMED. There was no membership check before the league read, so a
   * non-member could name a private league, learn its name and entry fee from
   * the returned checkout, and pay into it.
   *
   * ⚠ PAYING DOES NOT CONFER MEMBERSHIP, WHICH IS WHY GATING IS SAFE HERE.
   * Traced 2026-09-10: the webhook routes `league_entry_fee` to
   * `lib/league-finance/leagueFinanceService.ts`, which upserts a `leagueDues`
   * row keyed on (leagueId, userId, season) and creates no team claim and no
   * membership. So this is a DUES payment by someone already in the league,
   * not a join flow, and requiring membership breaks nothing. The only caller
   * is `FinanceTab`, which mounts inside `app/league/[leagueId]/LeagueShell`.
   *
   * ⚠ A non-member payment also left a stray paid-dues row in the
   * commissioner ledger for someone not in the league.
   */
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) {
    return NextResponse.json(
      { error: membership.status === 404 ? 'Not found' : 'Forbidden' },
      { status: membership.status },
    )
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, season: true },
  })
  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const finance = await getOrCreateLeagueFinance(leagueId)
  if (!finance) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  if (!finance.isPaidLeague || finance.entryFeeCents <= 0) {
    return NextResponse.json({ error: 'This league does not require a paid entry.' }, { status: 400 })
  }

  const season = await resolveSeasonForLeague(leagueId)

  /*
   * The guard every other checkout route already runs, and this one never did.
   *
   * It is redundant while the kill switch above is closed, and deliberately so:
   * if entry-fee processing is ever re-enabled, this is what still refuses a
   * `league_entry_fee` intent unless the compliance patterns are changed too —
   * which forces the legal decision to be made in one visible place rather than
   * by flipping an environment variable.
   */
  try {
    assertNoLeagueSettlementIntent('league_entry_fee', { leagueId, season })
  } catch (e) {
    if (isMonetizationComplianceError(e)) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.statusCode })
    }
    throw e
  }

  const APP_URL = getBaseUrl()
  const stripe = getStripeClient()

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: `${APP_URL}/dashboard?financePaid=${encodeURIComponent(leagueId)}`,
    cancel_url: `${APP_URL}/dashboard?financeCancelled=${encodeURIComponent(leagueId)}`,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: finance.currency || 'usd',
          product_data: {
            name: `League entry — ${league.name ?? 'AllFantasy league'}`,
            description: `Season ${season} entry fee`,
          },
          unit_amount: finance.entryFeeCents,
        },
      },
    ],
    metadata: {
      purchaseType: 'league_entry_fee',
      purchase_type: 'league_entry_fee',
      leagueId,
      userId,
      season: String(season),
    },
  })

  return NextResponse.json({ url: checkoutSession.url })
}
