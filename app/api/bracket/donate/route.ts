import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getStripeClient } from "@/lib/stripe-client"
import { getBaseUrl } from "@/lib/get-base-url"
import {
  assertNoLeagueSettlementIntent,
  isMonetizationComplianceError,
} from "@/lib/monetization/compliance-guardrails"

const MIN_AMOUNT = 100
const MAX_AMOUNT = 50000

export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json()
    const amountCents = Number(body.amountCents)
    assertNoLeagueSettlementIntent("donation", {
      route: "/api/bracket/donate",
      type: "donation",
      amountCents: String(amountCents),
    })

    if (!amountCents || amountCents < MIN_AMOUNT || amountCents > MAX_AMOUNT) {
      return NextResponse.json(
        { error: `Amount must be between $${MIN_AMOUNT / 100} and $${MAX_AMOUNT / 100}` },
        { status: 400 }
      )
    }

    const stripe = getStripeClient()
    const baseUrl = getBaseUrl()

    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Support FanCred Brackets",
              description: "Thank you for supporting FanCred Brackets! This is a voluntary donation.",
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${baseUrl}/brackets?donation=success`,
      cancel_url: `${baseUrl}/brackets?donation=cancelled`,
      metadata: {
        type: "donation",
        userId: session.user.id,
        amountCents: String(amountCents),
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
    console.error("Donation checkout error:", err)
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 })
  }
}
