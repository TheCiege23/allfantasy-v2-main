import 'server-only'

import { prisma } from '@/lib/prisma'
import { getRookieDraftOrderConfig, computeRookieDraftOrder } from '@/lib/league/rookieDraftOrder'

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
 * the live draft needs `Roster` ids. There is no FK between the two, so teams
 * and rosters are paired by canonical id order — the same convention
 * `getStandingsForLottery` already uses for this exact problem.
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
      rosters: { select: { id: true }, orderBy: { id: 'asc' } },
      teams: { select: { id: true }, orderBy: { id: 'asc' } },
    },
  })
  if (!league) return null

  const rosters = league.rosters ?? []
  const teams = league.teams ?? []
  const rosterIdByTeamId = new Map<string, string>()
  for (let i = 0; i < teams.length; i++) {
    rosterIdByTeamId.set(teams[i].id, rosters[i]?.id ?? teams[i].id)
  }

  return result.slots.map((s) => ({
    slot: s.slot,
    rosterId: rosterIdByTeamId.get(s.teamId) ?? s.teamId,
    displayName: s.teamName || s.ownerName,
  }))
}
