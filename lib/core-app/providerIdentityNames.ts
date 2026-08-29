import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Name a roster id from the provider's OWN athlete record.
 *
 * ⚠ THE NAMES WERE ALREADY IN THE DATABASE. Measured on production 2026-08-29:
 * all 98 ESPN starting-slot ids on imported rosters are present in
 * `sports_core_player_provider_identities` as `provider='espn'` rows carrying a
 * `display_name` — 1,257 rows, 100% named. Only 2% are linked to a canonical
 * player, which is why every downstream read failed; but naming a player and
 * linking him are different jobs, and only the second one was blocked.
 *
 * So an ESPN manager saw "Player we could not identify" for all eleven starters
 * while the eleven names sat one join away, keyed on the exact id the roster
 * holds.
 *
 * ── Why this join is safe when the obvious ones are not ────────────────────
 *
 * 🛑 DO NOT REPLACE THIS WITH `SportsPlayer.externalId`. That column is unique
 * only WITHIN a sport, so ESPN's numeric ids collide with college players:
 * measured, ESPN id `15847` matches Matthew Jester (LB, Princeton) and
 * `4880281` matches Jordyn Tyson (WR, Arizona State), both NCAAF rows. That
 * join is not a partial bridge, it is a fabrication that puts a stranger in
 * your lineup.
 *
 * 🛑 AND DO NOT NAME-MATCH. `PlayerIdentityMap` holds 178 NFL duplicate groups
 * that no key separates.
 *
 * This lookup is neither. `(provider, sportKey, providerPlayerId)` is the
 * provider's own primary key for its own athlete — the row IS the ESPN record
 * for that id. There is nothing to guess and nothing to collide with.
 *
 * ── What it deliberately does not give you ─────────────────────────────────
 *
 * A NAME AND NOTHING ELSE. Those rows carry no position (0 of 1,257) and no
 * team (0 of 1,257) — only a name and, for 95%, a birthday. So a player found
 * this way has no projection, no headshot, no game context and no bench-check
 * eligibility, and every one of those stays null rather than being inferred
 * from the name. Naming him is a fact the row supports; pricing him is not.
 */

export type ProviderIdentityName = {
  /** The provider's own display name, e.g. "Zac Alcorn" or "BUF D/ST". */
  name: string
}

/**
 * `providerPlayerId` → the provider's display name, for the ids that have one.
 *
 * Returns an empty map rather than throwing: a lineup that cannot be named is
 * the state this exists to improve, never a reason to fail the whole screen.
 */
export async function lookupProviderIdentityNames(
  platform: string,
  sport: string,
  ids: string[],
): Promise<Map<string, ProviderIdentityName>> {
  const out = new Map<string, ProviderIdentityName>()
  const provider = platform.trim().toLowerCase()
  /*
   * Sleeper ids already resolve through `SportsPlayer.sleeperId`, so asking
   * here would be a second read for an answer we hold. This is the fallback for
   * the platforms that have no bridge.
   */
  if (!provider || provider === 'sleeper' || ids.length === 0) return out

  const rows = await prisma.playerProviderIdentity
    .findMany({
      where: {
        provider,
        sportKey: sport.trim().toUpperCase(),
        providerPlayerId: { in: ids },
      },
      select: { providerPlayerId: true, displayName: true },
    })
    .catch(() => [])

  for (const r of rows) {
    const name = r.displayName?.trim()
    if (!name || out.has(r.providerPlayerId)) continue
    out.set(r.providerPlayerId, { name })
  }
  return out
}
