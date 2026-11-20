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
