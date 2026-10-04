import 'server-only'

import { prisma } from '@/lib/prisma'
import { injuryNameKey, injuryNameVariants } from './injuryNames'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
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
 */
export async function readInjuryStatusById(
  sport: string,
  namesById: ReadonlyMap<string, readonly string[]>,
  teamsById?: ReadonlyMap<string, string | null>,
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
      orderBy: { fetchedAt: 'desc' },
      select: { playerName: true, status: true, team: true },
    })
    .catch(() => [])

  /* Keep newest-first alias history so each player can select the latest matching club. */
  const injuryByName = new Map<string, Array<{ status: string | null; team?: string | null; order: number }>>()
  for (const [order, i] of injuries.entries()) {
    const k = injuryNameKey(i.playerName)
    const list = injuryByName.get(k) ?? []
    list.push({ ...i, order })
    injuryByName.set(k, list)
  }

  /* Resolve aliases per player; the newest club-compatible report wins, including a cleared status. */
  const injuryById = new Map<string, string>()
  for (const [id, names] of namesById) {
    const club = normalizeTeamAbbrev(teamsById?.get(id))
    let freshest: { status: string | null; order: number } | undefined
    for (const n of names) {
      const match = injuryByName.get(injuryNameKey(n))?.find((row) => !club || !row.team || normalizeTeamAbbrev(row.team) === club)
      if (match && (!freshest || match.order < freshest.order)) freshest = match
    }
    if (freshest?.status) injuryById.set(id, freshest.status)
  }
  return injuryById
}
