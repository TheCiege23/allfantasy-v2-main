import 'server-only'

import { unstable_cache } from 'next/cache'

import { prisma } from '@/lib/prisma'

/**
 * The first future kickoff a source explicitly STATES is regular season.
 *
 * Used by empty states to tell "nothing has been synced" apart from "the
 * season has not started" — two situations that look identical from a table
 * of zero scored weeks, and that call for opposite advice. Before the first
 * regular-season kickoff, "import or re-sync a league" prescribes a fix for
 * something that is not broken; after it, that copy is right again.
 *
 * ⚠ `seasonType` IS STATED OR ABSENT, NEVER GUESSED. Production stores the
 * same game once per source and only some sources fill `seasonType` (see the
 * fixtures comments in lib/core-app/dash34.ts) — so this reads the first row
 * that SAYS 'regular'. When no source states one, this returns null and the
 * caller keeps its fallback copy rather than inventing a date. Preseason
 * fixtures are deliberately not the boundary: fantasy weeks score against the
 * regular season, and the 27 Aug preseason game starting is not the season
 * starting.
 *
 * Cached for 5 minutes — the answer is identical for every user, and the only
 * moment staleness matters is the kickoff boundary itself, where a late flip
 * of empty-state copy is harmless. Stored as an ISO STRING on purpose:
 * `unstable_cache` serialises through JSON, so a Date would come back as a
 * string on a cache hit anyway; storing the string makes both paths the same.
 */
const readFirstStatedKickoff = unstable_cache(
  async (sport: string) => {
    const game = await prisma.sportsGame
      .findFirst({
        where: { sport, seasonType: 'regular', startTime: { gt: new Date() } },
        orderBy: { startTime: 'asc' },
        select: { startTime: true },
      })
      .catch(() => null)
    return game?.startTime ? game.startTime.toISOString() : null
  },
  ['season-phase-first-stated-kickoff'],
  { revalidate: 300 },
)

/**
 * ISO instant of the first stated regular-season kickoff still in the future,
 * or null when no source states one. Defaults to NFL: every surface reading
 * this today is built on `WeeklyMatchup`, which is written from Sleeper
 * fantasy-football leagues only.
 */
export async function getFirstStatedKickoff(sport = 'NFL'): Promise<string | null> {
  return readFirstStatedKickoff(sport).catch(() => null)
}
