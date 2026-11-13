import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getUserSessionFromCookie } from '@/lib/api-auth'

export type ResolvedPlatformUser = {
  appUserId: string | null
  legacyUsername: string | null
}

/**
 * The platform user is the NextAuth session user, and nobody else.
 *
 * 🛑 THE LEGACY `af_session` COOKIE MUST NEVER RESOLVE TO AN AppUser. It carries a
 * Sleeper HANDLE, not an account id, and this used to look the handle up as
 * `appUser.username OR profile.sleeperUsername` when no NextAuth session was
 * present. A Sleeper handle is not proof of anything: an attacker could link a
 * handle equal to a victim's AllFantasy username, mint `af_session` for it, re-link
 * their own profile elsewhere, and from then on every route built on this function
 * (DMs, league chat, notifications, wallet, community posts) ran as the victim.
 *
 * `af_session` is only ever minted for a caller who already holds a NextAuth
 * session (`requireLegacySleeperIdentity` → `requireAuth`), so a caller whose
 * NextAuth session has lapsed simply signs in again. `legacyUsername` is still
 * returned for the legacy surfaces that display it; it grants no identity.
 */
export async function resolvePlatformUser(): Promise<ResolvedPlatformUser> {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string | null }
  } | null

  const appUserId = session?.user?.id ? String(session.user.id) : null
  const legacyCookie = await getUserSessionFromCookie()
  const legacyUsername = legacyCookie?.sleeperUsername || null

  return { appUserId, legacyUsername }
}
