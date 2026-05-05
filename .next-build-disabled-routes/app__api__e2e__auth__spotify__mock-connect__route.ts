import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

function isE2EEnabled(): boolean {
  return process.env.NODE_ENV !== "production"
}

export async function POST() {
  if (!isE2EEnabled()) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 })
  }

  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const providerAccountId = `mock-spotify-${userId}`
  const nowEpoch = Math.floor(Date.now() / 1000)

  await prisma.authAccount.deleteMany({
    where: {
      userId,
      provider: "spotify",
    },
  })

  await prisma.authAccount.create({
    data: {
      userId,
      type: "oauth",
      provider: "spotify",
      providerAccountId,
      access_token: "mock-access-token",
      refresh_token: "mock-refresh-token",
      token_type: "Bearer",
      scope: "user-read-email",
      expires_at: nowEpoch + 3600,
    },
  })

  await prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      spotifyAccessToken: "mock-access-token",
      spotifyRefreshToken: "mock-refresh-token",
      spotifyExpiresAt: new Date(Date.now() + 3600 * 1000),
      spotifyDisplayName: "Spotify Mock User",
      spotifyConnectedAt: new Date(),
    },
    update: {
      spotifyAccessToken: "mock-access-token",
      spotifyRefreshToken: "mock-refresh-token",
      spotifyExpiresAt: new Date(Date.now() + 3600 * 1000),
      spotifyDisplayName: "Spotify Mock User",
      spotifyConnectedAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true })
}
