import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { hasAllFantasyTestAccess, hasAiAccess, hasChatAdminAccess, hasPoolAdminAccess, isAfCommissioner, isSiteAdmin } from "@/lib/auth/admin"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/** GET /api/user/me — session user + isAdmin for client (e.g. landing header). */
export async function GET() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string; email?: string | null; name?: string | null; username?: string | null }
  } | null

  if (!session?.user) {
    return NextResponse.json({ user: null, isAdmin: false })
  }

  const isAdmin = isSiteAdmin(session.user)
  const profile = session.user.id
    ? await prisma.userProfile
        .findUnique({
          where: { userId: session.user.id },
          select: { notificationPreferences: true },
        })
        .catch(() => null)
    : null
  const notificationPreferences =
    profile?.notificationPreferences && typeof profile.notificationPreferences === "object"
      ? (profile.notificationPreferences as Record<string, unknown>)
      : {}
  const aiSettings =
    notificationPreferences.aiSettings && typeof notificationPreferences.aiSettings === "object"
      ? notificationPreferences.aiSettings
      : {}
  const subscriptionTier = isAfCommissioner(session.user)
    ? "af_commissioner"
    : hasAiAccess(session.user)
      ? "af_pro"
      : "free"

  return NextResponse.json({
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      username: session.user.username,
    },
    isAdmin,
    subscriptionTier,
    aiSettings,
    entitlements: {
      allFantasyTestAccess: hasAllFantasyTestAccess(session.user),
      afCommissioner: isAfCommissioner(session.user),
      aiAccess: hasAiAccess(session.user),
      poolAdminAccess: hasPoolAdminAccess(session.user),
      chatAdminAccess: hasChatAdminAccess(session.user),
    },
  })
}
