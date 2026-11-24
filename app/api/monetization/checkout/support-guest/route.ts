import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth"
import { isAppleIosShellRequest } from "@/lib/monetization/isAppleIosShellRequest"
import { enforcePaidSubscriptionGeo } from "@/lib/geo/enforcePaidSubscriptionGeo"
import { buildSupportGuestCheckoutParams } from "@/lib/monetization/supportGuestCheckout"
import { getStripeClient } from "@/lib/stripe-client"
import { getClientIp, rateLimit } from "@/lib/rate-limit"

/**
 * POST — start the no-account "Support AllFantasy monthly" checkout
 * (lib/monetization/supportGuestCheckout). Returns `{ url }`, Stripe's hosted page.
 *
 * A SIGNED-IN visitor is refused with `use_account_checkout`: they buy through the normal
 * subscription route, which knows who they are, reuses their Stripe customer and refuses a
 * plan they already pay for. Nothing here can attach a purchase to a signed-in account.
 *
 * Under /api/monetization/checkout on purpose: middleware already refuses that prefix from
 * the iOS app and in paid-blocked states. Both are checked again here as defence in depth.
 */
export async function POST(req: Request) {
  try {
    if (isAppleIosShellRequest(req)) {
      return NextResponse.json({ error: "Use Apple In-App Purchase in the iOS app." }, { status: 403 })
    }
    const geoBlock = await enforcePaidSubscriptionGeo(req)
    if (geoBlock) return geoBlock

    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (session?.user?.id) {
      return NextResponse.json({ code: "use_account_checkout" }, { status: 409 })
    }

    // Each call creates a Stripe Checkout Session; keep a stuck double-tap from minting dozens.
    const rl = rateLimit(`support-guest-checkout:${getClientIp(req)}`, 10, 10 * 60_000)
    if (!rl.success) {
      return NextResponse.json({ error: "Too many tries. Please wait a few minutes and try again." }, { status: 429 })
    }

    const body = (await req.json().catch(() => null)) as { ageConfirmed?: unknown } | null
    if (body?.ageConfirmed !== true) {
      return NextResponse.json(
        { error: "Please confirm you're 18 or older and agree to the Terms.", code: "age_required" },
        { status: 400 },
      )
    }

    const params = buildSupportGuestCheckoutParams({ ageConfirmed: true })
    if (!params) {
      console.error("[support-guest] no Stripe price configured for the supporter plan")
      return NextResponse.json({ error: "Monthly support isn't available right now." }, { status: 503 })
    }

    const checkout = await getStripeClient().checkout.sessions.create(params)
    if (!checkout.url) {
      return NextResponse.json({ error: "Checkout failed. Please try again." }, { status: 502 })
    }
    return NextResponse.json({ url: checkout.url })
  } catch (error) {
    // Never the raw message: a Stripe failure names the key's mode and tail.
    console.error("[support-guest] checkout error:", error instanceof Error ? error.message : "unknown")
    return NextResponse.json({ error: "Checkout failed. Please try again." }, { status: 500 })
  }
}
