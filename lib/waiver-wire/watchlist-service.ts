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
    /*
     * 🛑 `select` IS LOAD-BEARING HERE, NOT TIDINESS. Prisma returns every
     * scalar field unless told otherwise, and `schema.prisma` declares three
     * columns production does not have — `playerName`, `position`, `team`, each
     * carrying a literal `// <- ADD THIS` comment from whoever added them
     * without migrating. Reading them raises P2022.
     *
     * This was the only call in this file without a select, which is why
     * `waiver_watchlists` held ZERO rows: every add — from the waiver page and
     * from the player card alike — had been 500ing in production. Observed
     * 2026-09-08 as `POST /api/core/player-card/watch -> 500`, P2022 on
     * `waiver_watchlists.playerName`.
     *
     * Nothing in this service writes those three columns, so narrowing the
     * select is the correct shape rather than a workaround. If they are ever
     * genuinely wanted, they need a migration first — code ahead of its
     * migration does not no-op.
     */
    select: { id: true },
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
