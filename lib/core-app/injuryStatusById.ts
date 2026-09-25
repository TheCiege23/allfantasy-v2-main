import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * A player's current injury designation, by Sleeper id — the input to `isRuledOut`.
 *
 * Extracted from `resolvePlayers` in `myTeam.ts` so My Team and the `/core/matchup` scoreboard read
 * a starter's status the same way. The scoreboard had no injury read at all and counted an OUT
 * starter at his full projection, on the screen that exists to say who is going to win.
 */

/**
 * Every spelling each vendor has for one player, kept only to look injuries up by.
 *
 * 39 of 11,960 NFL ids disagree about the name — "Chris Rodriguez" and "Chris Rodriguez Jr." are
 * one running back — and `SportsInjury` is keyed on a name, not an id. Composing down to a single
 * spelling before the lookup would silently drop the match for whichever half is not stored.
 */
export function namesBySleeperId(
  rows: ReadonlyArray<{ sleeperId: string | null; name: string }>,
): Map<string, string[]> {
  const namesById = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.sleeperId) continue
    const held = namesById.get(r.sleeperId)
    if (held) held.push(r.name)
    else namesById.set(r.sleeperId, [r.name])
  }
  return namesById
}

/**
 * The newest status on file for each player, across every spelling he is stored under. A player
 * with no status on file is absent from the map. A failed read is an empty map: unknown, which
 * `isRuledOut` treats as available — never a reason to zero someone.
 */
export async function readInjuryStatusById(
  sport: string,
  namesById: ReadonlyMap<string, readonly string[]>,
): Promise<Map<string, string>> {
  const allNames = [...new Set([...namesById.values()].flat())]
  if (allNames.length === 0) return new Map()

  const injuries = await prisma.sportsInjury
    .findMany({
      // Every vendor spelling, deliberately — see `namesBySleeperId`. A superset costs one `IN`
      // list and is the only way the 39 divergent names both match.
      where: { sport, playerName: { in: allNames } },
      orderBy: { fetchedAt: 'desc' },
      select: { playerName: true, status: true },
    })
    .catch(() => [])

  /*
   * ⚠ FIRST WINS, NOT LAST, AND THE `orderBy` ABOVE IS WHY. `new Map(pairs)` resolves a
   * duplicate key to the LAST pair, so feeding it rows sorted `fetchedAt: desc` kept the
   * OLDEST status for anyone with more than one row — the exact opposite of what the sort
   * asks for. Measured on production 2026-08-28: `sportsInjury` holds 6,426 NFL rows and
   * 989 players have more than one, one of them 133. Every one of those was reading stale.
   *
   * Building the map explicitly and skipping a key already present keeps the newest row,
   * matching `injByPlayer` in `runInjuryImpactDashboard.ts`, which had this right already.
   */
  const injuryByName = new Map<string, string | null>()
  for (const i of injuries) {
    const k = i.playerName.toLowerCase()
    if (!injuryByName.has(k)) injuryByName.set(k, i.status)
  }

  /*
   * ⚠ RESOLVED PER PLAYER, ACROSS EVERY SPELLING HE IS STORED UNDER. The lookup used to run
   * against whichever vendor row the loop was on, so for the 39 ids whose vendors disagree about
   * the name it was a coin toss whether a status was found at all — and a missed status is not
   * cosmetic: `ruledOut` turns a projection into a hard 0.0.
   *
   * A hit on ANY spelling counts. Two spellings both matching is possible in principle; the first
   * wins, and `injuryByName` above has already kept the newest row per name, so neither candidate
   * is stale.
   */
  const injuryById = new Map<string, string>()
  for (const [id, names] of namesById) {
    for (const n of names) {
      const status = injuryByName.get(n.trim().toLowerCase())
      if (status) {
        injuryById.set(id, status)
        break
      }
    }
  }
  return injuryById
}
