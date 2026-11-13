/**
 * Platform identities attach **external** provider accounts to an **AllFantasy** user.
 *
 * - **Primary key for the person on AF**: `AppUser.id` / `UserProfile.userId` (same UUID) — always use this for auth, leagues, and permissions.
 * - **Provider ids** (`platformUserId`, e.g. Sleeper `user_id`): secondary; only identify rows within that provider’s import/sync flows. Never treat as the main user key on the AF site.
 */
import { prisma } from '@/lib/prisma'

type Platform = 'sleeper' | 'yahoo' | 'mfl' | 'fantrax' | 'espn'

/** Thrown when this provider account is already linked to a different AllFantasy user (AF `userId` is authoritative). */
export class PlatformIdentityConflictError extends Error {
  constructor(
    message = 'This external account is already linked to another AllFantasy user.',
  ) {
    super(message)
    this.name = 'PlatformIdentityConflictError'
  }
}

export async function upsertPlatformIdentity(params: {
  afUserId:         string
  platform:         Platform
  platformUserId:   string
  platformUsername: string
  displayName?:     string
  avatarUrl?:       string
  sport?:           string
}) {
  const { afUserId, platform, platformUserId,
          platformUsername, displayName, avatarUrl, sport } = params

  const existing = await prisma.platformIdentity.findFirst({
    where: { platform, platformUserId }
  })

  if (existing) {
    if (existing.userId !== afUserId) {
      throw new PlatformIdentityConflictError()
    }
    return prisma.platformIdentity.update({
      where: { id: existing.id },
      data: {
        userId: afUserId,
        platformUsername,
        displayName:  displayName ?? platformUsername,
        avatarUrl:    avatarUrl ?? existing.avatarUrl,
        lastSyncedAt: new Date(),
      }
    })
  }

  return prisma.platformIdentity.create({
    data: {
      userId:          afUserId,
      platform,
      platformUserId,
      platformUsername,
      displayName:     displayName ?? platformUsername,
      avatarUrl,
      sport:           sport ?? 'nfl',
      firstImportAt:   new Date(),
      lastSyncedAt:    new Date(),
    }
  })
}

export async function isPlatformRankLocked(
  afUserId: string,
  platform: Platform
): Promise<boolean> {
  const identity = await prisma.platformIdentity.findFirst({
    where: { userId: afUserId, platform }
  })
  return identity?.rankLocked ?? false
}

export async function lockPlatformRank(
  afUserId: string,
  platform: Platform
): Promise<void> {
  await prisma.platformIdentity.updateMany({
    where: { userId: afUserId, platform },
    data:  { rankLocked: true },
  })
}

