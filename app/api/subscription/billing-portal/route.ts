import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getStripeClient } from "@/lib/stripe-client"
import { enforcePaidSubscriptionGeo } from "@/lib/geo/enforcePaidSubscriptionGeo"

export const dynamic = "force-dynamic"

/** Apple's page for managing App Store subscriptions; on an iPhone it opens the Subscriptions screen. */
const APPLE_MANAGE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions"

function appOrigin(): string {
  const fromAuth = process.env.NEXTAUTH_URL?.replace(/\/$/, "")
  if (fromAuth) return fromAuth
  const vercel = process.env.VERCEL_URL
  if (vercel) return vercel.startsWith("http") ? vercel : `https://${vercel}`
  return "http://localhost:3000"
}

/*
 * Every caller opens this as a page (an <a href>, never fetch), so an error answered as JSON put
 * {"error":"…"} on screen in place of the app. Failures now land back on the Billing tab, which
 * reads `?billing=portal_error` and says what happened; a signed-out visit goes to sign-in.
 */
function backToBilling(reason: "portal_error"): NextResponse {
  return NextResponse.redirect(new URL(`/settings?tab=billing&billing=${reason}`, appOrigin()))
}

export async function GET(req: Request) {
  try {
    // The portal is where subscriptions are cancelled; a VPN must never block that.
    const geoBlock = await enforcePaidSubscriptionGeo(req, { blockVpnOrProxy: false })
    if (geoBlock) {
      /*
       * The geo gate answers 451 JSON — right for the fetch() callers it was written for, but this
       * route is opened as a PAGE, so that body was printed raw ({"error":"PAID_GEO_BLOCKED",…}).
       * The body already names where a browser belongs (`redirectTo`); send it there. Only a
       * same-site path is followed, never an absolute URL from the body.
       */
      const body = (await geoBlock.clone().json().catch(() => ({}))) as { redirectTo?: unknown }
      const target =
        typeof body.redirectTo === "string" && body.redirectTo.startsWith("/") && !body.redirectTo.startsWith("//")
          ? body.redirectTo
          : "/paid-restricted"
      return NextResponse.redirect(new URL(target, appOrigin()))
    }

    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.redirect(
        new URL(`/login?callbackUrl=${encodeURIComponent("/settings?tab=billing")}`, appOrigin()),
      )
    }

    /*
     * ⚠ AN APP STORE SUBSCRIBER HAS NO STRIPE CUSTOMER, and was sent to /pricing "no subscription" —
     * told they had nothing while paying Apple every month. Only Apple can change or cancel that
     * subscription, so a live Apple subscription with no live Stripe one goes to Apple's own page.
     * "Live Stripe" and not "any Stripe customer": a long-cancelled Stripe plan must not route a
     * current Apple subscriber into a portal that cannot touch what they pay for. (Inside the iOS app
     * the Billing tab opens the native sheet instead and never reaches this route.)
     */
    const live = await prisma.userSubscription.findMany({
      where: { userId: session.user.id, status: { notIn: ["canceled", "expired"] } },
      select: { source: true, stripeCustomerId: true },
    })
    const liveApple = live.some((r) => r.source === "apple")
    const liveStripe = live.some((r) => r.source !== "apple" && Boolean(r.stripeCustomerId))
    if (liveApple && !liveStripe) return NextResponse.redirect(APPLE_MANAGE_SUBSCRIPTIONS_URL)

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
      return backToBilling("portal_error")
    }

    return NextResponse.redirect(portal.url)
  } catch (e) {
    console.error("[subscription/billing-portal]", e instanceof Error ? e.message : e)
    return backToBilling("portal_error")
  }
}
