import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { computeAndSaveRank } from '@/lib/ranking/computeAndSaveRank'
import type { ResolvedLegacyUser } from '@/lib/legacy-user-resolver'

/** Internal: a concurrent link claimed this Sleeper account first. Never escapes this module. */
class PlatformIdentityRaceError extends Error {
  constructor() {
    super('PLATFORM_IDENTITY_RACE')
    this.name = 'PlatformIdentityRaceError'
  }
}

export type LinkAfUserToLegacyOptions = {
  /** When true, skip calling `computeAndSaveRank` (caller will sync leagues first). */
  skipComputeRank?: boolean
}

/**
 * Link the authenticated AF account to the Sleeper legacy profile so `/api/user/rank` and rankings UI work.
 * Does not create `League` / `SleeperLeague` rows (those come from full import or on-site leagues only).
 */
export async function linkAfUserToLegacy(
  afUserId: string,
  resolved: ResolvedLegacyUser,
  options?: LinkAfUserToLegacyOptions,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const conflictResponse = () =>
    NextResponse.json(
      {
        error:
          'This Sleeper account is already linked to another AllFantasy login. Sign in with that account or use a different Sleeper username.',
        code: 'PLATFORM_IDENTITY_CONFLICT',
      },
      { status: 409 },
    )

  // BOTH ownership checks run BEFORE any write. Previously the second one ran after
  // `AppUser.legacyUserId` had already been updated and, when the Sleeper id was taken,
  // silently skipped the profile write — leaving the account linked via one store and
  // unlinked via the other, so callers disagreed about whether the user had a Sleeper
  // account depending on which table they happened to read. Refusing up front keeps the
  // three stores in step: either the whole link lands, or none of it does.
  const [legacyTaken, sleeperIdTaken] = await Promise.all([
    prisma.appUser.findFirst({
      where: { legacyUserId: resolved.id, id: { not: afUserId } },
      select: { id: true },
    }),
    prisma.userProfile.findFirst({
      where: { sleeperUserId: resolved.sleeperUserId, userId: { not: afUserId } },
      select: { userId: true },
    }),
  ])
  if (legacyTaken || sleeperIdTaken) {
    return { ok: false, response: conflictResponse() }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.appUser.update({
        where: { id: afUserId },
        data: { legacyUserId: resolved.id },
      })

      await tx.userProfile.upsert({
        where: { userId: afUserId },
        update: {
          sleeperUsername: resolved.sleeperUsername,
          sleeperUserId: resolved.sleeperUserId,
          sleeperLinkedAt: new Date(),
        },
        create: {
          userId: afUserId,
          sleeperUsername: resolved.sleeperUsername,
          sleeperUserId: resolved.sleeperUserId,
          sleeperLinkedAt: new Date(),
        },
      })

      // Third store, written in the SAME transaction so it can never drift from the other
      // two. This is the row `resolveLinkedAccounts` reads to tell whether two AppUsers are
      // the same human, so a link that skipped it would be invisible to the duplicate gate.
      const existingIdentity = await tx.platformIdentity.findFirst({
        where: { platform: 'sleeper', platformUserId: resolved.sleeperUserId },
        select: { id: true, userId: true },
      })
      if (existingIdentity && existingIdentity.userId !== afUserId) {
        // Lost a race against a concurrent link — roll the whole thing back rather than
        // point two AF users at one Sleeper account.
        throw new PlatformIdentityRaceError()
      }
      if (existingIdentity) {
        await tx.platformIdentity.update({
          where: { id: existingIdentity.id },
          data: {
            platformUsername: resolved.sleeperUsername,
            displayName: resolved.displayName ?? resolved.sleeperUsername,
            lastSyncedAt: new Date(),
          },
        })
      } else {
        await tx.platformIdentity.create({
          data: {
            userId: afUserId,
            platform: 'sleeper',
            platformUserId: resolved.sleeperUserId,
            platformUsername: resolved.sleeperUsername,
            displayName: resolved.displayName ?? resolved.sleeperUsername,
            avatarUrl: resolved.avatarUrl ?? resolved.avatar ?? null,
            firstImportAt: new Date(),
            lastSyncedAt: new Date(),
          },
        })
      }
    })
  } catch (err) {
    if (err instanceof PlatformIdentityRaceError) {
      return { ok: false, response: conflictResponse() }
    }
    throw err
  }

  if (options?.skipComputeRank) {
    return { ok: true }
  }

  const leagueCount = await prisma.legacyLeague.count({
    where: { userId: resolved.id },
  })
  if (leagueCount > 0) {
    await computeAndSaveRank(afUserId).catch(() => null)
  }

  return { ok: true }
}
