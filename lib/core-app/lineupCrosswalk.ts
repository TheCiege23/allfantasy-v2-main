import 'server-only'
import { crosswalkToSleeperIds } from './rosterIdCrosswalk'
import { normalizeIdentitySport, resolveFantraxIdentities } from '@/lib/player-identity/resolveRosterPlayerIdentities'

/**
 * `rosterId` → `sleeperId` for the matchup board: the shared crosswalk, plus Fantrax NFL.
 *
 * 🛑 A FANTRAX LINEUP NAMED NOBODY. `crosswalkToSleeperIds` bridges ESPN, Fleaflicker and MFL; Fantrax has no
 * entry, so every starter in a Fantrax league came back unresolved and the board said "None of the 18 players in
 * this lineup could be identified — we hold no id bridge for fantrax" (production, 2026-11-20). The bridge exists:
 * `PlayerIdentityMap.fantraxId` sits beside `sleeperId`, and My Team and the draft archive already read it through
 * `resolveFantraxIdentities`. This reads the same registry with the same one-to-one guard — an id two rows share
 * is refused, never resolved to either.
 *
 * ⚠ NFL ONLY, AND ONLY HERE. A Fantrax college or NBA row carries no Sleeper id, so there is nothing to translate
 * to. And the shared crosswalk is left as it is on purpose: a dozen readers use it (scoring, lineup locks, trade
 * discovery), and adding a platform there changes all of them at once.
 */
export async function lineupCrosswalkToSleeperIds(
  platform: string,
  sport: string,
  rosterIds: string[],
): Promise<Map<string, string>> {
  const identitySport = normalizeIdentitySport(sport)
  if (platform.trim().toLowerCase() !== 'fantrax' || identitySport !== 'NFL') {
    return crosswalkToSleeperIds(platform, sport, rosterIds)
  }
  const out = new Map<string, string>()
  for (const [rosterId, identity] of await resolveFantraxIdentities(identitySport, rosterIds)) {
    if (identity.sleeperId) out.set(rosterId, identity.sleeperId)
  }
  return out
}

/** A starter as the identity registry names him: no Sleeper id, so no headshot, projection or injury status. */
export type LineupRegistryName = { name: string; position: string | null; team: string | null }

/**
 * Names for the Fantrax NFL starters `lineupCrosswalkToSleeperIds` could not translate.
 *
 * The registry knows many Fantrax players by name with no Sleeper id beside it (staging 2026-11-20: 88 of the
 * 204 players in one league's first six draft rounds). The board showed those as a blank row — "2 of 18 players in
 * this lineup could not be identified" on production — though the name, position and club were on file. This
 * returns only that: the name is the registry's, and nothing else is inferred from it.
 */
export async function lineupRegistryNames(
  platform: string,
  sport: string,
  rosterIds: string[],
): Promise<Map<string, LineupRegistryName>> {
  const out = new Map<string, LineupRegistryName>()
  const identitySport = normalizeIdentitySport(sport)
  if (platform.trim().toLowerCase() !== 'fantrax' || identitySport !== 'NFL' || rosterIds.length === 0) return out
  for (const [rosterId, identity] of await resolveFantraxIdentities(identitySport, rosterIds)) {
    if (identity.name) out.set(rosterId, { name: identity.name, position: identity.position, team: identity.team })
  }
  return out
}
