import 'server-only'

import { prisma } from '@/lib/prisma'
import { importedActivityLeagueWhere, managerKeysOf, teamResolver, type AttributableTeam } from './importedActivityAttribution'
import { ACTIVITY_KINDS, dedupeActivityByEvent, describeImportedActivityRows, type LeagueActivityItem } from './leagueActivity'

/**
 * YOUR moves in one league — trades, waiver claims and adds/drops — for My Team.
 *
 * WHY. The league home has a league-wide feed; the roster page had nothing, so "what did I change
 * this week?" meant scanning everyone's activity for your own name. The rows were already there.
 *
 * Nothing here is a second rule: the league is matched by `importedActivityLeagueWhere` (sibling
 * importer rows included), a row is yours by `teamResolver` over `normalized.managerKeys` (the one
 * attribution rule), rows become readable items through `describeImportedActivityRows`, and one
 * event is one item by `dedupeActivityByEvent` — the same four the league feed uses.
 */

export type TeamActivity = {
  items: LeagueActivityItem[]
  /** Newest row we hold for the WHOLE league — how current the feed is, not when you last moved. */
  feedNewest: Date | null
}

/** Rows read before filtering to your team. A league's activity is dense; yours is a fraction. */
const SCAN = 300

export async function getTeamActivity(args: {
  league: { id: string; platform: string | null; platformLeagueId: string | null; sport?: string | null }
  team: AttributableTeam
  limit?: number
}): Promise<TeamActivity | null> {
  const limit = args.limit ?? 6
  const rows = await prisma.decisionOsImportedActivity
    .findMany({
      where: { activityType: { in: ACTIVITY_KINDS }, ...importedActivityLeagueWhere(args.league) },
      orderBy: { occurredAt: 'desc' },
      take: SCAN,
      select: { id: true, activityType: true, occurredAt: true, rosterId: true, payload: true, normalized: true },
    })
    .catch(() => null)
  if (rows == null) return null
  if (rows.length === 0) return { items: [], feedNewest: null }

  const attribution = teamResolver([args.team])
  await attribution.withProfileKeys(rows.flatMap((r) => managerKeysOf(r.normalized)))
  const mine = rows.filter((r) => managerKeysOf(r.normalized).some((k) => attribution.resolve(k) != null))

  const picked = mine.slice(0, limit * 3)
  const { items } = await describeImportedActivityRows(picked, {
    leagueId: args.league.id,
    platform: args.league.platform,
    sport: args.league.sport ?? null,
  })
  /*
   * ⚠ A TRADE'S ADDS ARE BOTH SIDES' ADDS. Sleeper sends `adds`/`drops` as player → receiving
   * roster, and the shared describer keeps only the player ids — right for a league feed, wrong for
   * "your moves", where "+ Player" would list what the OTHER team received. Scoped here to your
   * roster (`externalId` IS Sleeper's roster_id). A row whose shape carries no map is kept whole
   * rather than guessed at. `describeImportedActivityRows` is one row in, one item out, same order.
   */
  const scoped = items.map((item, i) => {
    const payload = (picked[i]?.payload ?? {}) as { adds?: unknown; drops?: unknown }
    const mineIn = sideOf(payload.adds, args.team.externalId)
    const mineOut = sideOf(payload.drops, args.team.externalId)
    return {
      ...item,
      adds: mineIn ? item.adds.filter((p) => mineIn.has(p.id)) : item.adds,
      drops: mineOut ? item.drops.filter((p) => mineOut.has(p.id)) : item.drops,
    }
  })
  return { items: dedupeActivityByEvent(scoped).slice(0, limit), feedNewest: rows[0].occurredAt }
}

/** Player ids a `{ playerId: rosterId }` map assigns to this roster; null when the value is not such a map. */
export function sideOf(raw: unknown, rosterExternalId: string): Set<string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !rosterExternalId) return null
  const out = new Set<string>()
  for (const [playerId, rosterId] of Object.entries(raw as Record<string, unknown>)) {
    if (String(rosterId) === rosterExternalId) out.add(playerId)
  }
  return out
}
