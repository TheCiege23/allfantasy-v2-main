import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isAppleIosShellRequest } from "@/lib/monetization/isAppleIosShellRequest"
import { prisma } from "@/lib/prisma"
import {
  PRO_WEEK_REASON_REFERRER,
  proWeekDaysFromEnv,
  REFERRER_WEEKS_PER_WINDOW,
  referrerWindowStart,
} from "@/lib/referral/proWeek"

export const dynamic = "force-dynamic"

/**
 * GET /api/referral/pro-week-offer — "give a week, get a week" (lib/referral/proWeek.ts) as the
 * surfaces that PROMOTE it should describe it. A label only: the award decides on the server.
 *
 *   { days, cap, earnedInWindow }   earnedInWindow: null when signed out
 *
 * 🛑 The iOS shell always gets `days: 0`: the app honours a week someone earned, but never advertises
 * the offer (App Store 3.1.1 / 3.1.3) — the free trial's rule.
 */
export async function GET(req: Request) {
  const noStore = { "cache-control": "private, no-store" }
  const days = isAppleIosShellRequest(req) ? 0 : proWeekDaysFromEnv()
  if (days <= 0) return NextResponse.json({ days: 0, cap: 0, earnedInWindow: null }, { headers: noStore })
  const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ days, cap: REFERRER_WEEKS_PER_WINDOW, earnedInWindow: null }, { headers: noStore })
  const earnedInWindow = await prisma.adminSubscriptionGrant
    .count({ where: { userId, reason: PRO_WEEK_REASON_REFERRER, createdAt: { gte: referrerWindowStart(new Date()) } } })
    .catch(() => null)
  return NextResponse.json({ days, cap: REFERRER_WEEKS_PER_WINDOW, earnedInWindow }, { headers: noStore })
}
