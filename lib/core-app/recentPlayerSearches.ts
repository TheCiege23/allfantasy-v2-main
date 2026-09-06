import 'server-only'

import { prisma } from '@/lib/prisma'
import { asHeadshotUrl } from './playerIdentityCompose'

/**
 * "Recently searched" — the Player Finder rail's per-account history.
 *
 * Guap's call (2026-09-02): per account, not per device. One row per
 * (user, sport, player), `searchedAt` bumped on every signed-in player view,
 * capped at `KEEP` rows per user so the table cannot grow with a manager's
 * curiosity.
 *
 * ⚠ IT NEVER THROWS, IN EITHER DIRECTION. A convenience list must not fail a
 * page render, and the two ways it could are both real here: a deploy that
 * ships ahead of the migration raises P2021 (missing table), and a write on a
 * GET is the one thing on this page that can hit a lock. Both degrade to "no
 * recent searches", which is exactly what the rail shows for a new account.
 */

export type RecentPlayerSearch = {
  sport: string
  externalId: string
  sleeperId: string | null
  name: string
  position: string | null
  team: string | null
  /** The headshot as the catalog holds it today — read at list time, never stored, so a changed image is never stale here. */
  imageUrl: string | null
  searchedAt: Date
}

const KEEP = 20

export async function recordRecentPlayerSearch(
  userId: string,
  player: {
    sport: string
    externalId: string
    sleeperId: string | null
    name: string
    position: string | null
    team: string | null
  }
): Promise<void> {
  if (!userId || !player.sport || !player.externalId) return
  try {
    await prisma.recentPlayerSearch.upsert({
      where: {
        userId_sport_externalId: { userId, sport: player.sport, externalId: player.externalId },
      },
      create: {
        userId,
        sport: player.sport,
        externalId: player.externalId,
        sleeperId: player.sleeperId,
        name: player.name,
        position: player.position,
        team: player.team,
      },
      // The name, team and position are refreshed on every view so a traded
      // player's row does not keep his old team.
      update: {
        searchedAt: new Date(),
        sleeperId: player.sleeperId,
        name: player.name,
        position: player.position,
        team: player.team,
      },
    })

    const stale = await prisma.recentPlayerSearch.findMany({
      where: { userId },
      orderBy: { searchedAt: 'desc' },
      skip: KEEP,
      select: { id: true },
    })
    if (stale.length > 0) {
      await prisma.recentPlayerSearch.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })
    }
  } catch {
    // See the header: silence is the documented behaviour, before and after the migration.
  }
}

/**
 * The newest searches for the rail, excluding the player currently on screen —
 * a list headed by the name already in the search box is noise.
 */
export async function listRecentPlayerSearches(
  userId: string,
  options: { limit?: number; exclude?: { sport: string; externalId: string } | null } = {}
): Promise<RecentPlayerSearch[]> {
  const limit = options.limit ?? 5
  if (!userId) return []
  try {
    const rows = await prisma.recentPlayerSearch.findMany({
      where: { userId },
      orderBy: { searchedAt: 'desc' },
      take: limit + 1,
      select: {
        sport: true,
        externalId: true,
        sleeperId: true,
        name: true,
        position: true,
        team: true,
        searchedAt: true,
      },
    })
    const ex = options.exclude
    const kept = rows
      .filter((r) => !(ex && r.sport === ex.sport && r.externalId === ex.externalId))
      .slice(0, limit)
    if (kept.length === 0) return []

    /*
     * The headshot comes from the catalog at list time rather than from the
     * search row: the row is a bookmark, and a bookmark that carried its own
     * copy of the image would keep showing it after the catalog changed. One
     * read for the handful of rows; a miss is a lettered tile, never a throw.
     */
    const players = await prisma.sportsPlayer
      .findMany({
        where: { OR: kept.map((r) => ({ sport: r.sport, externalId: r.externalId })) },
        select: { sport: true, externalId: true, imageUrl: true },
      })
      .catch(() => [] as Array<{ sport: string; externalId: string; imageUrl: string | null }>)
    const imageBy = new Map<string, string | null>()
    for (const p of players) {
      const key = `${p.sport}:${p.externalId}`
      const url = asHeadshotUrl(p.imageUrl)
      if (url || !imageBy.has(key)) imageBy.set(key, url)
    }
    return kept.map((r) => ({ ...r, imageUrl: imageBy.get(`${r.sport}:${r.externalId}`) ?? null }))
  } catch {
    return []
  }
}
