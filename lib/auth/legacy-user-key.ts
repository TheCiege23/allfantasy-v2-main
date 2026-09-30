import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserSessionFromCookie } from '@/lib/api-auth'
import { resolveLegacyIdentityForAppUser } from '@/lib/legacy-identity'

export async function resolveLegacyUserKeyForCurrentSession(): Promise<string | null> {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string | null }
  } | null

  const appUserId = session?.user?.id ? String(session.user.id) : ''
  if (appUserId) {
    const legacyCookie = (await getUserSessionFromCookie())
    const identity = await resolveLegacyIdentityForAppUser({
      appUserId,
      fallbackSleeperUsername: legacyCookie?.sleeperUsername || null,
      createIfMissing: true,
    })
    if (identity?.recommendedUserId) return identity.recommendedUserId
  }

  const legacyCookie = (await getUserSessionFromCookie())
  return legacyCookie?.sleeperUsername || null
}
