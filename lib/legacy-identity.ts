import { prisma } from '@/lib/prisma'
import { resolveOrCreateLegacyUser } from '@/lib/legacy-user-resolver'

type LegacyIdentityResolutionSource =
  | 'app_user_legacy_link'
  | 'app_user_profile_sleeper_id'
  | 'app_user_profile_sleeper_username'
  | 'legacy_cookie_session'
  | 'none'

interface ResolvedLegacyIdentity {
  appUserId: string
  legacyUserId: string | null
  sleeperUsername: string | null
  sleeperUserId: string | null
  recommendedUserId: string | null
  source: LegacyIdentityResolutionSource
}

function normalizeUsername(value: string | null | undefined): string | null {
  const v = String(value || '').trim().toLowerCase()
  return v.length > 0 ? v : null
}

export async function resolveLegacyIdentityForAppUser(args: {
  appUserId: string
  fallbackSleeperUsername?: string | null
  createIfMissing?: boolean
}): Promise<ResolvedLegacyIdentity | null> {
  const createIfMissing = args.createIfMissing ?? true

  const appUser = await (prisma as any).appUser.findUnique({
    where: { id: args.appUserId },
    select: {
      id: true,
      legacyUserId: true,
      legacyUser: {
        select: {
          id: true,
          sleeperUsername: true,
          sleeperUserId: true,
        },
      },
      profile: {
        select: {
          sleeperUsername: true,
          sleeperUserId: true,
        },
      },
    },
  })

  if (!appUser) return null

  if (appUser.legacyUser) {
    return {
      appUserId: appUser.id,
      legacyUserId: appUser.legacyUser.id,
      sleeperUsername: appUser.legacyUser.sleeperUsername,
      sleeperUserId: appUser.legacyUser.sleeperUserId,
      recommendedUserId: appUser.legacyUser.sleeperUsername || appUser.legacyUser.id,
      source: 'app_user_legacy_link',
    }
  }

  let resolvedLegacyUser: any = null
  let source: LegacyIdentityResolutionSource = 'none'

  const profileSleeperUserId = appUser.profile?.sleeperUserId ? String(appUser.profile.sleeperUserId).trim() : null
  const profileSleeperUsername = normalizeUsername(appUser.profile?.sleeperUsername)
  const fallbackUsername = normalizeUsername(args.fallbackSleeperUsername)

  if (profileSleeperUserId) {
    resolvedLegacyUser = await (prisma as any).legacyUser.findUnique({
      where: { sleeperUserId: profileSleeperUserId },
      select: { id: true, sleeperUsername: true, sleeperUserId: true },
    })
    if (resolvedLegacyUser) source = 'app_user_profile_sleeper_id'
  }

  if (!resolvedLegacyUser && profileSleeperUsername) {
    resolvedLegacyUser = await (prisma as any).legacyUser.findUnique({
      where: { sleeperUsername: profileSleeperUsername },
      select: { id: true, sleeperUsername: true, sleeperUserId: true },
    })
    if (resolvedLegacyUser) source = 'app_user_profile_sleeper_username'
  }

  if (!resolvedLegacyUser && fallbackUsername) {
    resolvedLegacyUser = await (prisma as any).legacyUser.findUnique({
      where: { sleeperUsername: fallbackUsername },
      select: { id: true, sleeperUsername: true, sleeperUserId: true },
    })
    if (resolvedLegacyUser) source = 'legacy_cookie_session'
  }

  if (!resolvedLegacyUser && createIfMissing && profileSleeperUsername) {
    try {
      const created = await resolveOrCreateLegacyUser(profileSleeperUsername)
      if (created) {
        resolvedLegacyUser = {
          id: created.id,
          sleeperUsername: created.sleeperUsername,
          sleeperUserId: created.sleeperUserId,
        }
        source = 'app_user_profile_sleeper_username'
      }
    } catch {
      // Non-fatal: leave unresolved if upstream lookups fail.
    }
  }

  if (resolvedLegacyUser && appUser.legacyUserId !== resolvedLegacyUser.id) {
    await (prisma as any).appUser.update({
      where: { id: appUser.id },
      data: { legacyUserId: resolvedLegacyUser.id },
      select: { id: true },
    }).catch(() => null)
  }

  return {
    appUserId: appUser.id,
    legacyUserId: resolvedLegacyUser?.id || null,
    sleeperUsername: resolvedLegacyUser?.sleeperUsername || profileSleeperUsername || fallbackUsername || null,
    sleeperUserId: resolvedLegacyUser?.sleeperUserId || profileSleeperUserId || null,
    recommendedUserId: resolvedLegacyUser?.sleeperUsername || resolvedLegacyUser?.id || profileSleeperUsername || fallbackUsername || null,
    source,
  }
}
