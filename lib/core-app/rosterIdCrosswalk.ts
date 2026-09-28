import 'server-only'

import { prisma } from '@/lib/prisma'
import { reduceCrosswalk } from './crosswalkRules'
import { isForeignIdSpace } from './rosterIdSpace'

/**
 * The id to look a roster id up by on a Sleeper-keyed table — or null, when there is none.
 *
 * 🛑 THIS REPLACES `crosswalk.get(id) ?? id`, WHICH WAS WRONG FOR EVERY FOREIGN PLATFORM. The
 * fallback exists because a Sleeper league's roster id IS its Sleeper id (and an unmatched ESPN
 * id is long and collides with nothing). A Fleaflicker/MFL/Fantrax/Yahoo id is a short number in
 * Sleeper's range — 44 of 248 on the one production Fleaflicker league ARE real Sleeper ids — so
 * the fallback looked it up as a Sleeper id and My Team, the matchup board and its projections
 * named and priced a stranger. For a foreign league an unmapped id resolves to NOTHING, and the
 * caller's own honest fallback (provider name, "could not identify", unprojected) takes over.
 */
export function sleeperLookupId(
  platform: string | null | undefined,
  rosterId: string,
  crosswalk: ReadonlyMap<string, string>,
): string | null {
  return crosswalk.get(rosterId) ?? (isForeignIdSpace(platform) ? null : rosterId)
}

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

/**
 * Which `PlayerIdentityMap` column holds a given platform's own id.
 *
 * Fleaflicker and MFL joined 2026-09-27, once `fantasyCalcIdentityBridge.ts` began filling their
 * columns (both held zero rows before). This returns a MAP; what a caller does with an id the map
 * does not hold is that caller's rule and is unchanged here.
 */
const ID_COLUMN_BY_PLATFORM: Record<string, 'espnId' | 'fleaflickerId' | 'mflId'> = {
  espn: 'espnId',
  fleaflicker: 'fleaflickerId',
  mfl: 'mflId',
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
      select: { espnId: true, fleaflickerId: true, mflId: true, sleeperId: true },
    })
    .catch(() => [] as Array<{ espnId: string | null; fleaflickerId: string | null; mflId: string | null; sleeperId: string | null }>)

  /*
   * The one-to-one guard lives in a pure module so it can be tested without
   * loading prisma — see `crosswalkRules.ts` for why an ambiguous id must be
   * dropped rather than resolved to whichever row came back first.
   */
  return reduceCrosswalk(rows.map((r) => ({ from: r[column], to: r.sleeperId })))
}
