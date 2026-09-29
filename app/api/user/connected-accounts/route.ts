import { hasAppleSignInCredentials } from "@/lib/auth/appleSignInEnv"
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export type SignInProviderId = "google" | "spotify" | "apple" | "facebook" | "instagram" | "x" | "tiktok"

const PROVIDER_IDS: SignInProviderId[] = ["google", "spotify", "apple", "facebook", "instagram", "x", "tiktok"]

const PROVIDER_NAMES: Record<SignInProviderId, string> = {
  google: "Google",
  spotify: "Spotify",
  apple: "Apple",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X (Twitter)",
  tiktok: "TikTok",
}

function isProviderConfigured(providerId: SignInProviderId): boolean {
  switch (providerId) {
    case "google":
      return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    case "spotify":
      return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
    case "apple":
      return hasAppleSignInCredentials()
    case "facebook":
      // Temporarily disabled — Facebook login is under review. Env vars are preserved.
      // Re-enable by restoring: return !!(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET)
      return false
    case "instagram":
    case "x":
    case "tiktok":
      return false
    default:
      return false
  }
}

function normalizeProviderForSettings(provider: string): SignInProviderId | null {
  const lowered = provider.trim().toLowerCase()
  if (lowered === "twitter") return "x"
  if (PROVIDER_IDS.includes(lowered as SignInProviderId)) {
    return lowered as SignInProviderId
  }
  return null
}

/**
 * GET /api/user/connected-accounts
 * Returns sign-in provider status: configured (env) and linked (AuthAccount) for the current user.
 */
export async function GET() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const [accounts, user] = await Promise.all([
    (prisma as any).authAccount.findMany({
      where: { userId: session.user.id },
      select: { provider: true },
    }).catch(() => []),
    (prisma as any).appUser.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true },
    }).catch(() => null),
  ])

  const linkedSet = new Set(
    (accounts as { provider: string }[])
      .map((entry) => normalizeProviderForSettings(entry.provider))
      .filter(Boolean) as SignInProviderId[]
  )
  const linkedCount = PROVIDER_IDS.filter((id) => linkedSet.has(id)).length
  const hasPassword = !!user?.passwordHash

  const providers = PROVIDER_IDS.map((id) => {
    const linked = linkedSet.has(id)
    const disconnectable = linked && (linkedCount > 1 || hasPassword)
    return {
      id,
      name: PROVIDER_NAMES[id],
      configured: isProviderConfigured(id),
      linked,
      disconnectable,
      disconnectBlockedReason: linked && !disconnectable ? "LOCKOUT_RISK" : null,
    }
  })

  return NextResponse.json({ providers })
}
