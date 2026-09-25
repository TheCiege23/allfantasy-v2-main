import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStripeClient } from "@/lib/stripe-client"
import { getBaseUrl } from "@/lib/get-base-url"
import { enforcePaidAccountLock } from "@/lib/geo/enforcePaidAccountLock"
import {
  assertNoLeagueSettlementIntent,
  isMonetizationComplianceError,
} from "@/lib/monetization/compliance-guardrails"

export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // A card-locked account never reaches Stripe (lib/subscription/paidStateRefusal).
    const accountLock = await enforcePaidAccountLock(session.user.id)
    if (accountLock) return accountLock

    const body = await req.json()
    const { leagueId, paymentType } = body

    if (!leagueId || !paymentType) {
      return NextResponse.json({ error: "Missing leagueId or paymentType" }, { status: 400 })
    }

    if (!["first_bracket_fee", "unlimited_unlock"].includes(paymentType)) {
      return NextResponse.json({ error: "Invalid paymentType" }, { status: 400 })
    }

    assertNoLeagueSettlementIntent(String(paymentType), {
      route: "/api/bracket/stripe/checkout",
      paymentType: String(paymentType),
      leagueId: String(leagueId ?? ""),
    })

    const member = await (prisma as any).bracketLeagueMember.findUnique({
      where: {
        leagueId_userId: { leagueId, userId: session.user.id },
      },
      select: { leagueId: true },
    }).catch(() => null)

    if (!member) {
      return NextResponse.json({ error: "You must be a league member" }, { status: 403 })
    }

    const league = await (prisma as any).bracketLeague.findUnique({
      where: { id: leagueId },
      select: { id: true, tournamentId: true, scoringRules: true },
    })

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 })
    }

    const rules = (league.scoringRules || {}) as any
    if (!rules.isPaidLeague) {
      return NextResponse.json({ error: "This is a free league" }, { status: 400 })
    }

    const existingCompleted = await (prisma as any).bracketPayment.findFirst({
      where: {
        userId: session.user.id,
        leagueId,
        tournamentId: league.tournamentId,
        paymentType,
        status: "completed",
      },
    })

    if (existingCompleted) {
      return NextResponse.json({ error: "Already paid", alreadyPaid: true }, { status: 409 })
    }

    const existingPending = await (prisma as any).bracketPayment.findFirst({
      where: {
        userId: session.user.id,
        leagueId,
        tournamentId: league.tournamentId,
        paymentType,
        status: "pending",
        createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) },
      },
    })

    if (existingPending?.stripeSessionId) {
      const stripe = await getStripeClient()
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(existingPending.stripeSessionId)
        if (existingSession.status === "open" && existingSession.url) {
          return NextResponse.json({ url: existingSession.url })
        }
      } catch {}
    }

    const stripe = await getStripeClient()

    const products = await stripe.products.search({
      query: `metadata['app']:'fancred_brackets' AND metadata['type']:'${paymentType}'`,
    })

    if (products.data.length === 0) {
      return NextResponse.json(
        { error: "Payment products not configured. Please run the seed script." },
        { status: 500 }
      )
    }

    const product = products.data[0]
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 1 })

    if (prices.data.length === 0) {
      return NextResponse.json({ error: "No active price found" }, { status: 500 })
    }

    const price = prices.data[0]
    const baseUrl = getBaseUrl()

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{ price: price.id, quantity: 1 }],
      mode: "payment",
      success_url: `${baseUrl}/brackets/leagues/${leagueId}?payment=success&type=${paymentType}`,
      cancel_url: `${baseUrl}/brackets/leagues/${leagueId}?payment=cancelled`,
      metadata: {
        paymentType,
        userId: session.user.id,
        leagueId,
        tournamentId: league.tournamentId,
      },
    })

    await (prisma as any).bracketPayment.create({
      data: {
        userId: session.user.id,
        leagueId,
        tournamentId: league.tournamentId,
        paymentType,
        stripeSessionId: checkoutSession.id,
        amountCents: Number(price.unit_amount || 0),
        status: "pending",
      },
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (err: any) {
    if (isMonetizationComplianceError(err)) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode }
      )
    }
    console.error("Stripe checkout error:", err)
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 })
  }
}


