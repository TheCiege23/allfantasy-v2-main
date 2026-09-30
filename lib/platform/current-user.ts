import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getUserSessionFromCookie } from '@/lib/api-auth'

export type ResolvedPlatformUser = {
  appUserId: string | null
  legacyUsername: string | null
}

export async function resolvePlatformUser(): Promise<ResolvedPlatformUser> {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string | null }
  } | null

  const appUserId = session?.user?.id ? String(session.user.id) : null
  const legacyCookie = (await getUserSessionFromCookie())
  const legacyUsername = legacyCookie?.sleeperUsername || null

  if (appUserId) {
    return { appUserId, legacyUsername }
  }

  if (!legacyUsername) {
    return { appUserId: null, legacyUsername: null }
  }

  const fallbackUser = await prisma.appUser.findFirst({
    where: {
      OR: [{ username: legacyUsername }, { profile: { sleeperUsername: legacyUsername } }],
    },
    select: { id: true },
  })

  return {
    appUserId: fallbackUser?.id || null,
    legacyUsername,
  }
}
