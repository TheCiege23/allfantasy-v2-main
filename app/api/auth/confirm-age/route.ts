import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

/**
 * Has this user confirmed their age? Folded onto the EXISTING route rather than added as a
 * new one — this repo sits at Vercel's hard 2048-route ceiling, so a new route would break
 * the build rather than 404.
 *
 * Needed because OAuth signups created accounts with `ageConfirmedAt` null: the /signup
 * checkbox never reached the server, so users who HAD ticked it are indistinguishable from
 * users who never did. Their consent cannot be backfilled honestly, so it has to be asked
 * for once, and the prompt needs a way to know who to ask.
 *
 * Returns `confirmed: true` for signed-out callers so the prompt never renders for them —
 * there is no one to ask, and an anonymous visitor must not be nagged.
 */
export async function GET() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ confirmed: true, authenticated: false })
  }

  try {
    const profile = await (prisma as any).userProfile.findUnique({
      where: { userId: session.user.id },
      select: { ageConfirmedAt: true },
    })
    return NextResponse.json({
      confirmed: Boolean(profile?.ageConfirmedAt),
      authenticated: true,
    })
  } catch (err) {
    console.error("[confirm-age] status read failed:", err)
    // Fail QUIET, not closed: a database hiccup must not throw a legal modal in front of
    // every signed-in user. The feature gates that actually depend on this still hold.
    return NextResponse.json({ confirmed: true, authenticated: true, degraded: true })
  }
}

export async function POST() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 })
  }

  try {
    await (prisma as any).userProfile.upsert({
      where: { userId: session.user.id },
      update: { ageConfirmedAt: new Date() },
      create: { userId: session.user.id, ageConfirmedAt: new Date() },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[confirm-age] Error:", err)
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }
}
