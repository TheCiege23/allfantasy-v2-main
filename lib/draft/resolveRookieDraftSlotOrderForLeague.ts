import 'server-only'

import { prisma } from '@/lib/prisma'
import { getRookieDraftOrderConfig, computeRookieDraftOrder } from '@/lib/league/rookieDraftOrder'
import { buildRosterIdResolver } from '@/lib/league/league-settings-draft-sync'

export type RookieDraftSlotOrderEntry = { slot: number; rosterId: string; displayName: string }

/**
 * When a commissioner has turned on auto rookie-draft ordering (worst-to-first
 * or reverse-max-PF, via `PUT /api/commissioner/leagues/[leagueId]/rookie-draft-order`),
 * resolve it into a real slot order so the live draft engine actually uses it.
 *
 * Previously `computeRookieDraftOrder`'s result only ever reached a preview UI —
 * nothing fed it into `buildSlotOrderForLeague`, so a commissioner could pick
 * "worst record picks first" and it would silently have zero effect on the draft.
 *
 * `computeRookieDraftOrder` orders `LeagueTeam` rows (the standings model);
 * the live draft needs `Roster` ids. There is no FK between the two, so each
 * team is resolved to its own roster by `buildRosterIdResolver` — the team's
 * `externalId`, else its owner. (It used to pair the two lists by id order,
 * which for random UUIDs is an arbitrary pairing.)
 */
export async function resolveRookieDraftSlotOrderForLeague(
  leagueId: string,
): Promise<RookieDraftSlotOrderEntry[] | null> {
  const config = await getRookieDraftOrderConfig(leagueId)
  if (!config?.enabled) return null

  const result = await computeRookieDraftOrder(leagueId, config.mode)
  if (result.slots.length === 0) return null

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      rosters: { select: { id: true, platformUserId: true } },
      teams: { select: { id: true, externalId: true, claimedByUserId: true, platformUserId: true } },
    },
  })
  if (!league) return null

  // 🛑 Each team's OWN roster. This used to sort both lists by random UUID and pair them by
  // index, so the worst team's first pick went to whichever manager's roster id sorted there —
  // and a team without a pair got its team id seated, which the pick authority never accepts.
  const resolveRosterId = buildRosterIdResolver(league.rosters ?? [], league.teams ?? [])
  const slots = result.slots.map((s) => ({
    slot: s.slot,
    rosterId: resolveRosterId(s.teamId),
    displayName: s.teamName || s.ownerName,
  }))
  // An order that cannot place every team is not applied (the caller keeps the default order).
  if (slots.some((s) => !s.rosterId)) return null
  return slots as RookieDraftSlotOrderEntry[]
}
