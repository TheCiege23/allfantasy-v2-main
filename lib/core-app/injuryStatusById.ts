import 'server-only'

import { prisma } from '@/lib/prisma'
import { injuryNameVariants } from './injuryNames'
import { createInjuryRowMatcher, injuryClaimAsOf } from '@/lib/injuries/matchInjuryRows'
import { priorSeasonCutoff } from '@/lib/injuries/injuryRecency'

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
 *
 * 🛑 NEWEST CLAIM, NOT NEWEST FETCH, AND A NAMESAKE IS NEVER HIM (2026-10-11). This ordered rows by
 * `fetchedAt` and took the first one on a compatible club. Rolling Insights re-pulls Friday's
 * "Questionable" every 30 minutes, so on Sunday it out-ranked ESPN's "Active" from that morning and
 * a cleared starter flipped back to Questionable with every cron run. And with no club to compare —
 * the matchup board passed none — the Browns LB Justin Jefferson's "Out" zeroed the Vikings WR. Rows
 * now bind through the shared matcher: newest claim (`injuryClaimAsOf`) first, verified by club and
 * position, an unresolvable namesake refused.
 */
export async function readInjuryStatusById(
  sport: string,
  namesById: ReadonlyMap<string, readonly string[]>,
  teamsById?: ReadonlyMap<string, string | null>,
  positionsById?: ReadonlyMap<string, string | null>,
): Promise<Map<string, string>> {
  const allNames = [...new Set([...namesById.values()].flatMap((names) => names.flatMap(injuryNameVariants)))]
  if (allNames.length === 0) return new Map()

  const now = new Date()
  const injuries = await prisma.sportsInjury
    .findMany({
      // Every vendor spelling, deliberately — see `namesBySleeperId`. A superset costs one `IN`
      // list and is the only way the 39 divergent names both match.
      where: {
        sport,
        playerName: { in: allNames, mode: 'insensitive' },
        // A newly fetched archival report is not current lineup evidence.
        expiresAt: { gt: now },
        date: { gte: priorSeasonCutoff(now) },
      },
      select: { playerName: true, status: true, team: true, position: true, date: true, fetchedAt: true },
    })
    .catch(() => [])

  const match = createInjuryRowMatcher(injuries, sport)
  const injuryById = new Map<string, string>()
  for (const [id, names] of namesById) {
    const lookup = { team: teamsById?.get(id) ?? null, position: positionsById?.get(id) ?? null }
    let newest: (typeof injuries)[number] | undefined
    for (const name of new Set(names)) {
      const hit = match({ name, ...lookup })
      const top = hit && 'rows' in hit ? hit.rows[0] : undefined
      if (top && (!newest || injuryClaimAsOf(top).getTime() > injuryClaimAsOf(newest).getTime())) newest = top
    }
    if (newest?.status) injuryById.set(id, newest.status)
  }
  return injuryById
}
