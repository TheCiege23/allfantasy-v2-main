import { hasAppleSignInCredentials } from "@/lib/auth/appleSignInEnv"
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

const PROVIDER_IDS = ["google", "spotify", "apple", "facebook", "instagram", "x", "tiktok"] as const
type SignInProviderId = (typeof PROVIDER_IDS)[number]
const PROVIDER_NAMES: Record<SignInProviderId, string> = {
  google: "Google",
  spotify: "Spotify",
  apple: "Apple",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X (Twitter)",
  tiktok: "TikTok",
}

function normalizeProviderForSettings(provider: string): SignInProviderId | null {
  const lowered = provider.trim().toLowerCase()
  if (lowered === "twitter") return "x"
  if (PROVIDER_IDS.includes(lowered as SignInProviderId)) {
    return lowered as SignInProviderId
  }
  return null
}

function providerKeysForDelete(providerId: SignInProviderId): string[] {
  if (providerId === "x") return ["x", "twitter"]
  return [providerId]
}

function canDisconnectProvider(params: {
  isLinked: boolean
  linkedProvidersCount: number
  hasPassword: boolean
}): boolean {
  if (!params.isLinked) return false
  if (params.linkedProvidersCount > 1) return true
  return params.hasPassword
}

async function resolveProviderStatuses(userId: string) {
  const [accounts, user] = await Promise.all([
    (prisma as any).authAccount.findMany({
      where: { userId },
      select: { provider: true },
    }).catch(() => []),
    (prisma as any).appUser.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    }).catch(() => null),
  ])

  const linkedSet = new Set(
    (accounts as { provider: string }[])
      .map((entry) => normalizeProviderForSettings(entry.provider))
      .filter(Boolean) as SignInProviderId[]
  )

  const linkedCount = PROVIDER_IDS.filter((providerId) => linkedSet.has(providerId)).length
  const hasPassword = !!user?.passwordHash
  return {
    linkedSet,
    linkedCount,
    hasPassword,
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ providerId?: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const providerParam = String((await ctx?.params)?.providerId ?? "").trim().toLowerCase()
  const providerId = normalizeProviderForSettings(providerParam)
  if (!providerId) {
    return NextResponse.json({ error: "INVALID_PROVIDER" }, { status: 400 })
  }

  const before = await resolveProviderStatuses(session.user.id)
  const isLinked = before.linkedSet.has(providerId)
  if (!isLinked) {
    const providers = PROVIDER_IDS.map((id) => {
      const linked = before.linkedSet.has(id)
      const disconnectable = linked && (before.linkedCount > 1 || before.hasPassword)
      return {
        id,
        name: PROVIDER_NAMES[id],
        configured: id === "google"
          ? !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
          : id === "spotify"
            ? !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
          : id === "apple"
            ? hasAppleSignInCredentials()
            : false,
        linked,
        disconnectable,
        disconnectBlockedReason: linked && !disconnectable ? "LOCKOUT_RISK" : null,
      }
    })
    return NextResponse.json({ ok: true, unchanged: true, providers })
  }

  if (
    !canDisconnectProvider({
      isLinked,
      linkedProvidersCount: before.linkedCount,
      hasPassword: before.hasPassword,
    })
  ) {
    return NextResponse.json(
      { error: "LOCKOUT_RISK", message: "Add another sign-in method or password before disconnecting this provider." },
      { status: 400 }
    )
  }

  await (prisma as any).authAccount.deleteMany({
    where: {
      userId: session.user.id,
      provider: {
        in: providerKeysForDelete(providerId),
      },
    },
  }).catch(() => null)

  const after = await resolveProviderStatuses(session.user.id)
  const providers = PROVIDER_IDS.map((id) => {
    const linked = after.linkedSet.has(id)
    const disconnectable = linked && (after.linkedCount > 1 || after.hasPassword)
    return {
      id,
      name: PROVIDER_NAMES[id],
      configured: id === "google"
        ? !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
        : id === "spotify"
          ? !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
        : id === "apple"
          ? hasAppleSignInCredentials()
          : false,
      linked,
      disconnectable,
      disconnectBlockedReason: linked && !disconnectable ? "LOCKOUT_RISK" : null,
    }
  })

  return NextResponse.json({ ok: true, providers })
}
