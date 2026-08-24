import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { hasAllFantasyTestAccess, hasAiAccess, hasChatAdminAccess, hasPoolAdminAccess, isAfCommissioner, isSiteAdmin } from "@/lib/auth/admin"

export const dynamic = "force-dynamic"

/** GET /api/user/me — session user + isAdmin for client (e.g. landing header). */
export async function GET() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string; email?: string | null; name?: string | null; username?: string | null }
  } | null

  if (!session?.user) {
    return NextResponse.json({ user: null, isAdmin: false })
  }

  // Settings honesty (P2-5): this route used to fabricate a `subscriptionTier`
  // from the ADMIN ALLOWLIST (isAfCommissioner/hasAiAccess) — every real Stripe
  // subscriber read as "free". Its only consumer, the settings AI tab, is
  // removed; real plan state comes from /api/subscription/entitlements.
  const isAdmin = isSiteAdmin(session.user)

  return NextResponse.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      username: session.user.username,
    },
    isAdmin,
    entitlements: {
      allFantasyTestAccess: hasAllFantasyTestAccess(session.user),
      afCommissioner: isAfCommissioner(session.user),
      aiAccess: hasAiAccess(session.user),
      poolAdminAccess: hasPoolAdminAccess(session.user),
      chatAdminAccess: hasChatAdminAccess(session.user),
    },
  })
}
