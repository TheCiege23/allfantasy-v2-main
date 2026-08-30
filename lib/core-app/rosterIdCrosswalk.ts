import 'server-only'

import { prisma } from '@/lib/prisma'
import { reduceCrosswalk } from './crosswalkRules'

/**
 * Translate a platform's own roster ids into Sleeper ids.
 *
 * ⚠ THIS IS WHY THE CROSSWALK WAS WORTH FILLING. Every player-resolving surface
 * in `/core` joins on `SportsPlayer.sleeperId`, because for a Sleeper league the
 * roster id IS the Sleeper id. An ESPN roster carries ESPN athlete ids, so that
 * join has always returned nothing and those screens rendered raw numbers.
 *
 * `PlayerIdentityMap` now carries the bridge: `linkEspnIdentityMapByIdChain`
 * composes `espnId` onto rows that already hold a `sleeperId`, purely from id
 * links and never from a name. Measured on production 2026-08-30, immediately
 * after the first full linking run: of 176 distinct ESPN roster ids, 127 reach a
 * `PlayerIdentityMap` row, all 127 carry a `sleeperId`, and all 127 of those
 * exist in `SportsPlayer`.
 *
 * ⚠ SO THIS BUYS MORE THAN A NAME. `providerIdentityNames.ts` can only ever
 * label a slot, because the provider's athlete record holds no position and no
 * team. A translated id resolves through the ORDINARY path instead — position,
 * club crest, headshot, and a projection, because the projection feed is keyed
 * on Sleeper ids too. It is the difference between an ESPN lineup that is
 * readable and one that is priced.
 *
 * ⚠ AND IT IS NOT A NAME MATCH. Every hop is an id: roster id -> `espnId` on a
 * PIM row -> that same row's `sleeperId`. Name-matching ESPN ids is explicitly
 * the wrong move here — `PlayerIdentityMap` holds 178 NFL duplicate groups that
 * no key separates.
 */

/** Which `PlayerIdentityMap` column holds a given platform's own id. */
const ID_COLUMN_BY_PLATFORM: Record<string, 'espnId'> = {
  espn: 'espnId',
}

/**
 * `rosterId` → `sleeperId`, for the ids this app can bridge.
 *
 * Returns an empty map for Sleeper (whose roster ids already ARE Sleeper ids),
 * for any platform with no bridge column, and on a read failure — a lineup that
 * cannot be translated is the state this improves, never a reason to fail the
 * screen.
 */
export async function crosswalkToSleeperIds(
  platform: string,
  sport: string,
  rosterIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const column = ID_COLUMN_BY_PLATFORM[platform.trim().toLowerCase()]
  if (!column || rosterIds.length === 0) return out

  const rows = await prisma.playerIdentityMap
    .findMany({
      where: { sport: sport.trim().toUpperCase(), [column]: { in: rosterIds } },
      select: { espnId: true, sleeperId: true },
    })
    .catch(() => [])

  /*
   * The one-to-one guard lives in a pure module so it can be tested without
   * loading prisma — see `crosswalkRules.ts` for why an ambiguous id must be
   * dropped rather than resolved to whichever row came back first.
   */
  return reduceCrosswalk(rows.map((r) => ({ from: r[column], to: r.sleeperId })))
}
