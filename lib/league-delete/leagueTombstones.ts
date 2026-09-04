/**
 * Tombstones for leagues a user has removed from their dashboard.
 *
 * 🛑 THE PROBLEM THIS EXISTS FOR. `DELETE /api/league/[leagueId]` is a HARD
 * delete: the `League` row goes, and ~145 cascading children go with it. That
 * leaves the database unable to tell "this user never imported this league"
 * apart from "this user imported it and deliberately threw it away" — so the
 * next import, the next manual sync, or a cron-driven background import step
 * recreates it and the user watches a league they deleted reappear.
 *
 * It was already a felt problem before this module: `app/dashboard/DashboardShell.tsx`
 * carries a `sessionStorage` tombstone set for exactly this reason. That one
 * dies at tab close, does not cross devices, and cannot stop a server-side
 * recreate — it only hides the row after the fact.
 *
 * ⚠ MATCHING IS ON THE EXTERNAL IDENTITY, NOT `League.id`. A re-import mints a
 * brand new `League.id`, so an id-keyed tombstone would never match the thing
 * it was meant to suppress. Everything here keys on
 * (userId, platform, platformLeagueId).
 *
 * ⚠ EVERY CALLER MUST NORMALIZE THROUGH `tombstoneKeyFor`. The writer and the
 * readers live in different files and are edited months apart; if one of them
 * lowercases the platform and another does not, the tombstone silently stops
 * matching and the bug looks exactly like "the feature was never built". That
 * is why normalization is a function here and not a convention.
 */
import { prisma } from '@/lib/prisma'

export type LeagueTombstoneIdentity = {
  userId: string
  platform: string
  platformLeagueId: string
}

/**
 * Thrown by a SYNC path that was asked to touch a league the user deleted.
 *
 * Shared rather than redefined per call site so a route can catch one type and
 * map it to one status. Sync paths throw; the IMPORT path has its own error
 * (`ImportedLeagueTombstonedError`) because it carries the tombstone details
 * needed to render a confirmation prompt, and because the two mean different
 * things to a caller: a sync is simply refused, an import is offerable.
 */
export class LeagueDeletedByUserError extends Error {
  readonly code = 'LEAGUE_DELETED_BY_USER'
}

/**
 * The canonical (platform, platformLeagueId) pair.
 *
 * `League.platform` is stored lowercase in practice and the existing delete
 * route already compares it with `.toLowerCase()`, so lowercase is the shape a
 * tombstone is written and read under. `platformLeagueId` is the provider's own
 * id and is NOT case-folded — some providers issue mixed-case ids and folding
 * them would collapse two distinct leagues into one tombstone.
 */
export function tombstoneKeyFor(platform: string, platformLeagueId: string) {
  return {
    platform: String(platform ?? '').trim().toLowerCase(),
    platformLeagueId: String(platformLeagueId ?? '').trim(),
  }
}

/** A stable string form of the key, for Set/Map membership on the read paths. */
export function tombstoneLookupKey(platform: string, platformLeagueId: string): string {
  const key = tombstoneKeyFor(platform, platformLeagueId)
  return `${key.platform}:${key.platformLeagueId}`
}

function isUsableIdentity(platform: string, platformLeagueId: string): boolean {
  const key = tombstoneKeyFor(platform, platformLeagueId)
  return key.platform.length > 0 && key.platformLeagueId.length > 0
}

/**
 * Record that this user removed this league.
 *
 * Idempotent: re-deleting refreshes `deletedAt` rather than erroring, because a
 * user can delete, re-import, and delete again, and the second delete must not
 * 500 on a unique-constraint violation.
 *
 * Returns false without writing when the identity is unusable (an empty
 * platform or league id). A tombstone on an empty key would match nothing at
 * best and everything at worst, so a missing identity is skipped loudly at the
 * call site rather than written as a poison row.
 */
export async function recordLeagueTombstone(args: {
  userId: string
  platform: string
  platformLeagueId: string
  leagueName?: string | null
}): Promise<boolean> {
  const { userId } = args
  if (!userId?.trim()) return false
  if (!isUsableIdentity(args.platform, args.platformLeagueId)) return false

  const key = tombstoneKeyFor(args.platform, args.platformLeagueId)
  const leagueName = args.leagueName?.trim() || null

  await prisma.deletedLeagueTombstone.upsert({
    where: {
      userId_platform_platformLeagueId: {
        userId,
        platform: key.platform,
        platformLeagueId: key.platformLeagueId,
      },
    },
    create: {
      userId,
      platform: key.platform,
      platformLeagueId: key.platformLeagueId,
      leagueName,
      deletedAt: new Date(),
    },
    update: {
      deletedAt: new Date(),
      // Keep a name we already have if this delete could not supply one.
      ...(leagueName ? { leagueName } : {}),
    },
  })

  return true
}

/** True when this user has deleted this league and has not confirmed re-importing it. */
export async function isLeagueTombstoned(identity: LeagueTombstoneIdentity): Promise<boolean> {
  if (!identity.userId?.trim()) return false
  if (!isUsableIdentity(identity.platform, identity.platformLeagueId)) return false

  const key = tombstoneKeyFor(identity.platform, identity.platformLeagueId)
  const row = await prisma.deletedLeagueTombstone.findUnique({
    where: {
      userId_platform_platformLeagueId: {
        userId: identity.userId,
        platform: key.platform,
        platformLeagueId: key.platformLeagueId,
      },
    },
    select: { id: true },
  })

  return row != null
}

/**
 * Bulk lookup for the import discovery page, which renders many candidate
 * leagues at once.
 *
 * Returns a Set of `tombstoneLookupKey` strings. Callers MUST build their
 * membership test with `tombstoneLookupKey` rather than interpolating a key by
 * hand, or the normalization above is bypassed.
 *
 * One query for the whole page: a per-candidate `isLeagueTombstoned` would be
 * N round trips on a screen that already fans out to a provider.
 */
export async function getTombstonedLookupKeys(
  userId: string,
  candidates: ReadonlyArray<{ platform: string; platformLeagueId: string }>,
): Promise<Set<string>> {
  const empty = new Set<string>()
  if (!userId?.trim() || candidates.length === 0) return empty

  const usable = candidates.filter((c) => isUsableIdentity(c.platform, c.platformLeagueId))
  if (usable.length === 0) return empty

  const rows = await prisma.deletedLeagueTombstone.findMany({
    where: {
      userId,
      OR: usable.map((c) => {
        const key = tombstoneKeyFor(c.platform, c.platformLeagueId)
        return { platform: key.platform, platformLeagueId: key.platformLeagueId }
      }),
    },
    select: { platform: true, platformLeagueId: true },
  })

  return new Set(rows.map((r) => tombstoneLookupKey(r.platform, r.platformLeagueId)))
}

/**
 * Every league this user has deleted. For the import page's confirmation copy,
 * which wants the stored name and the date as well as the fact of it.
 */
export async function listLeagueTombstones(userId: string) {
  if (!userId?.trim()) return []
  return prisma.deletedLeagueTombstone.findMany({
    where: { userId },
    select: {
      platform: true,
      platformLeagueId: true,
      leagueName: true,
      deletedAt: true,
    },
    orderBy: { deletedAt: 'desc' },
  })
}

/**
 * Forget the deletion, because the user explicitly confirmed they want this
 * league back.
 *
 * ⚠ CLEAR IT, do not merely bypass it. If a confirmed re-import left the
 * tombstone in place, the league would import successfully and then be
 * suppressed again by the very next sync — the user would have confirmed the
 * import and still watched it vanish. Deleting the row is what makes the
 * confirmation stick.
 */
export async function clearLeagueTombstone(identity: LeagueTombstoneIdentity): Promise<boolean> {
  if (!identity.userId?.trim()) return false
  if (!isUsableIdentity(identity.platform, identity.platformLeagueId)) return false

  const key = tombstoneKeyFor(identity.platform, identity.platformLeagueId)
  const result = await prisma.deletedLeagueTombstone.deleteMany({
    where: {
      userId: identity.userId,
      platform: key.platform,
      platformLeagueId: key.platformLeagueId,
    },
  })

  return result.count > 0
}
