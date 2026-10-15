import 'server-only'

import type { LeagueSport } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'

/**
 * Who "plays" a sport: everyone who owns (created or imported) a league in it. The audience for
 * sport-wide alerts — breaking news and live game moments — that are not tied to one roster or one
 * followed team. Followers of the teams involved are added by each sender on top of this.
 *
 * ⚠ OWNERS ONLY, AND THAT IS A KNOWN UNDER-COUNT. `League.userId` is the account that brought the
 * league in; league-mates who joined through an invite are not listed here. They are still reached
 * through their own team follows, and this is the one membership signal that is cheap, indexed and
 * the same shape for every platform.
 *
 * Cached per process for 10 minutes: a busy night asks this for every close game.
 */
const CACHE_MS = 10 * 60 * 1000
/** A hard ceiling per alert. Dispatch is per-user and sequential; a cron run must stay bounded. */
export const SPORT_AUDIENCE_MAX = 5000

const cache = new Map<string, { at: number; ids: string[] }>()

export async function listUserIdsPlayingSport(sport: string): Promise<string[]> {
  const S = String(sport ?? '').toUpperCase()
  if (!isSupportedSport(S)) return []
  const key = normalizeToSupportedSport(S)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ids
  try {
    const rows = await prisma.league.findMany({
      where: { sport: key as LeagueSport },
      distinct: ['userId'],
      select: { userId: true },
      orderBy: { userId: 'asc' },
      take: SPORT_AUDIENCE_MAX,
    })
    const ids = rows.map((r) => r.userId).filter(Boolean)
    cache.set(key, { at: Date.now(), ids })
    return ids
  } catch (err) {
    console.error('[sportAudience] read failed:', err instanceof Error ? err.message : err)
    return []
  }
}
