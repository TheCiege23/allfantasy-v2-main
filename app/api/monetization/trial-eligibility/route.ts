import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isAppleIosShellRequest } from "@/lib/monetization/isAppleIosShellRequest"
import { TRIAL_SKUS, trialDaysFromEnv } from "@/lib/monetization/freeTrial"
import { hasNeverSubscribed } from "@/lib/monetization/freeTrialEligibility"

export const dynamic = "force-dynamic"

/**
 * GET /api/monetization/trial-eligibility — whether the plan cards should offer the AF Pro free trial
 * to THIS viewer (lib/monetization/freeTrial.ts). A label only: the checkout route decides again, on
 * the server, and that decision is the one Stripe sees.
 *
 *   { days, skus, eligible: true | false | null }   null = signed out (we cannot know yet)
 *
 * The iOS shell always gets `days: 0` — the app never shows a web offer (App Store 3.1.1 / 3.1.3).
 */
export async function GET(req: Request) {
  const days = isAppleIosShellRequest(req) ? 0 : trialDaysFromEnv()
  const noStore = { "cache-control": "private, no-store" }
  if (days <= 0) return NextResponse.json({ days: 0, skus: [], eligible: false }, { headers: noStore })
  const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ days, skus: TRIAL_SKUS, eligible: null }, { headers: noStore })
  const eligible = await hasNeverSubscribed(userId)
  return NextResponse.json({ days: eligible ? days : 0, skus: eligible ? TRIAL_SKUS : [], eligible }, { headers: noStore })
}
