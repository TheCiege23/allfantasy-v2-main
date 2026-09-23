import 'server-only'

import { headers } from 'next/headers'

import { prisma } from '@/lib/prisma'
import { isSpeculativeRequestHeaders } from '@/lib/http/speculativeRequest'

/**
 * The league a user last opened, kept on `AppUser.activeLeagueId`.
 *
 * That column has existed since the init migration and Chimmy's context providers already read it
 * as "the league this user is in right now" (lib/chimmy-context/providers/LeagueContextProvider.ts)
 * — nothing wrote it until league-first. So writing it also makes Chimmy default to the league
 * you last opened, which is the same promise from the other side.
 *
 * ⚠ SKIPS PREFETCHES, LIKE `touchLeagueViewed`. Next prefetches every league link that scrolls
 * into view; recording those would make "last league" mean "last link scrolled past".
 *
 * Fire and forget: a failed write costs the user one landing on the wrong league, a throw would
 * cost them the page.
 */
export async function rememberLastLeague(userId: string, leagueId: string): Promise<void> {
  try {
    if (isSpeculativeRequestHeaders(await headers())) return
    // updateMany: no throw when the AppUser row is absent, and no write when nothing changed.
    await prisma.appUser.updateMany({
      where: { id: userId, NOT: { activeLeagueId: leagueId } },
      data: { activeLeagueId: leagueId },
    })
  } catch {
    // Never let remembering a league affect the page.
  }
}

export async function readLastLeague(userId: string): Promise<string | null> {
  try {
    const row = await prisma.appUser.findUnique({ where: { id: userId }, select: { activeLeagueId: true } })
    return row?.activeLeagueId ?? null
  } catch {
    return null
  }
}
