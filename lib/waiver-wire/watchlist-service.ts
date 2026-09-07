import { prisma } from '@/lib/prisma'

/**
 * Server-backed waiver watchlist (Step 3C). Per-user, per-league. Pure persistence — the watchlist
 * never affects roster ownership, claims, or eligibility; it only marks players a user is tracking.
 */

export async function getWatchlistPlayerIds(leagueId: string, userId: string): Promise<string[]> {
  const rows = (await prisma.waiverWatchlist.findMany({
    where: { leagueId, userId },
    select: { playerId: true },
    orderBy: { createdAt: 'asc' },
  })) as Array<{ playerId: string }>
  return rows.map((r) => r.playerId)
}

/**
 * Is this one player watched? Used by the player card, which asks about exactly
 * one man and would otherwise pull the caller's whole list to answer.
 *
 * ⚠ IT LIVES HERE RATHER THAN IN THE CARD so there is ONE implementation of
 * "what counts as watched". A second copy in `lib/core-app` would be free to
 * drift from the writers above — which is the two-implementations-of-one-rule
 * bug this repo has already paid for once in SQL.
 */
export async function isWatched(leagueId: string, userId: string, playerId: string): Promise<boolean> {
  const pid = String(playerId).trim()
  if (!pid) return false
  const row = await prisma.waiverWatchlist.findUnique({
    where: { leagueId_userId_playerId: { leagueId, userId, playerId: pid } },
    select: { id: true },
  })
  return row != null
}

export async function addToWatchlist(leagueId: string, userId: string, playerId: string, sport?: string | null): Promise<void> {
  const pid = String(playerId).trim()
  if (!pid) return
  await prisma.waiverWatchlist.upsert({
    where: { leagueId_userId_playerId: { leagueId, userId, playerId: pid } },
    create: { leagueId, userId, playerId: pid, sport: sport ?? null },
    update: {},
  })
}

export async function removeFromWatchlist(leagueId: string, userId: string, playerId: string): Promise<void> {
  await prisma.waiverWatchlist.deleteMany({ where: { leagueId, userId, playerId: String(playerId).trim() } })
}

/** Bulk add (used for one-time migration of a client's localStorage watchlist). */
export async function mergeWatchlist(leagueId: string, userId: string, playerIds: string[], sport?: string | null): Promise<number> {
  const unique = [...new Set(playerIds.map((p) => String(p).trim()).filter(Boolean))]
  let added = 0
  for (const pid of unique) {
    const res = await prisma.waiverWatchlist.upsert({
      where: { leagueId_userId_playerId: { leagueId, userId, playerId: pid } },
      create: { leagueId, userId, playerId: pid, sport: sport ?? null },
      update: {},
      select: { id: true },
    })
    if (res) added += 1
  }
  return unique.length
}
