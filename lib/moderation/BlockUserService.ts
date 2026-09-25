/**
 * BlockUserService — global block list (PlatformBlockedUser) and thread-level block.
 */

import { prisma } from "@/lib/prisma"

export type BlockedUserInfo = { userId: string; username: string | null; displayName: string | null }

export async function addBlock(blockerUserId: string, blockedUserId: string): Promise<boolean> {
  if (!blockerUserId || !blockedUserId || blockerUserId === blockedUserId) return false
  try {
    await prisma.platformBlockedUser.upsert({
      where: {
        blockerUserId_blockedUserId: { blockerUserId, blockedUserId },
      },
      create: { blockerUserId, blockedUserId },
      update: {},
    })
    return true
  } catch {
    return false
  }
}

export async function removeBlock(blockerUserId: string, blockedUserId: string): Promise<boolean> {
  if (!blockerUserId || !blockedUserId) return false
  try {
    await prisma.platformBlockedUser.deleteMany({
      where: { blockerUserId, blockedUserId },
    })
    return true
  } catch {
    return false
  }
}

export async function getBlockedUserIds(blockerUserId: string): Promise<string[]> {
  if (!blockerUserId) return []
  try {
    const rows = await prisma.platformBlockedUser.findMany({
      where: { blockerUserId },
      select: { blockedUserId: true },
    })
    return rows.map((r) => r.blockedUserId)
  } catch {
    return []
  }
}

/** Prisma's "table does not exist". No table means no block row can exist, so it is an answer, not a failure. */
function isMissingTableError(err: unknown): boolean {
  return Boolean(err) && typeof err === "object" && (err as { code?: unknown }).code === "P2021"
}

/** Thrown when a block lookup failed and the caller must not proceed as though nobody is blocked. */
export class BlockListUnavailableError extends Error {
  constructor() {
    super("Block list unavailable")
    this.name = "BlockListUnavailableError"
  }
}

/**
 * The viewer's block list for FILTERING WHAT THEY READ — fail CLOSED.
 *
 * 🛑 `getBlockedUserIds` above answers `[]` when the query throws, and `[]` means "hide nobody": a
 * transient database error showed the viewer the messages of everyone they had blocked, with nothing
 * to say so. That fallback is kept for its other callers (thread listing, Chimmy's league-chat
 * tool), where it predates this; a message READ must not use it.
 *
 * One retry, because a blip should not cost the reader their chat. After that it throws
 * `BlockListUnavailableError` and the caller answers 503 — nothing is served unfiltered. A missing
 * table (P2021) is the one error that returns `[]`, because then no block can exist and `[]` is true.
 */
export async function getBlockedUserIdsForRead(blockerUserId: string): Promise<string[]> {
  if (!blockerUserId) return []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const rows = await prisma.platformBlockedUser.findMany({
        where: { blockerUserId },
        select: { blockedUserId: true },
      })
      return rows.map((r) => r.blockedUserId)
    } catch (err) {
      if (isMissingTableError(err)) return []
    }
  }
  throw new BlockListUnavailableError()
}

/**
 * Is there a block, in EITHER direction, between `userId` and any of `otherUserIds`?
 *
 * Used before starting a DM or huddle, or adding someone to one. Direction is deliberately not
 * returned: the refusal must not tell a blocked user that they were blocked, nor by whom.
 * Throws `BlockListUnavailableError` if the lookup fails — the caller refuses rather than guessing.
 */
export async function hasBlockBetween(userId: string, otherUserIds: string[]): Promise<boolean> {
  const others = Array.from(new Set(otherUserIds.filter((id) => id && id !== userId)))
  if (!userId || others.length === 0) return false
  try {
    const row = await prisma.platformBlockedUser.findFirst({
      where: {
        OR: [
          { blockerUserId: userId, blockedUserId: { in: others } },
          { blockerUserId: { in: others }, blockedUserId: userId },
        ],
      },
      select: { id: true },
    })
    return Boolean(row)
  } catch (err) {
    if (isMissingTableError(err)) return false
    throw new BlockListUnavailableError()
  }
}

export async function getBlockedUsersWithDetails(blockerUserId: string): Promise<BlockedUserInfo[]> {
  if (!blockerUserId) return []
  try {
    const rows = await prisma.platformBlockedUser.findMany({
      where: { blockerUserId },
      include: {
        blocked: { select: { id: true, username: true, displayName: true } },
      },
    })
    return rows.map((r) => ({
      userId: r.blocked.id,
      username: r.blocked.username ?? null,
      displayName: r.blocked.displayName ?? null,
    }))
  } catch {
    return []
  }
}

export function isUserBlockedBy(blockedUserId: string, blockerUserId: string, blockSet: Set<string>): boolean {
  return blockSet.has(blockedUserId)
}
