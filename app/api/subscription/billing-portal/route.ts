import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStripeClient } from "@/lib/stripe-client"
import { enforcePaidSubscriptionGeo } from "@/lib/geo/enforcePaidSubscriptionGeo"

export const dynamic = "force-dynamic"

function appOrigin(): string {
  const fromAuth = process.env.NEXTAUTH_URL?.replace(/\/$/, "")
  if (fromAuth) return fromAuth
  const vercel = process.env.VERCEL_URL
  if (vercel) return vercel.startsWith("http") ? vercel : `https://${vercel}`
  return "http://localhost:3000"
}

export async function GET(req: Request) {
  try {
    // The portal is where subscriptions are cancelled; a VPN must never block that.
    const geoBlock = await enforcePaidSubscriptionGeo(req, { blockVpnOrProxy: false })
    if (geoBlock) return geoBlock

    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const row = await prisma.userSubscription.findFirst({
      where: { userId: session.user.id, stripeCustomerId: { not: null } },
      select: { stripeCustomerId: true },
      orderBy: { updatedAt: "desc" },
    })

    const customerId = row?.stripeCustomerId
    if (!customerId) {
      return NextResponse.redirect(new URL("/pricing?msg=no_subscription", appOrigin()))
    }

    const stripe = getStripeClient()
    const returnUrl = `${appOrigin()}/settings?tab=billing`

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })

    if (!portal.url) {
      return NextResponse.json({ error: "Billing portal unavailable" }, { status: 500 })
    }

    return NextResponse.redirect(portal.url)
  } catch (e) {
    console.error("[subscription/billing-portal]", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "Failed to open billing portal" }, { status: 500 })
  }
}
