/**
 * Map between draft `slotOrder.rosterId` (Roster.id or LeagueTeam.id) and `LeagueTeam.id`.
 */

import { findRosterForTeam } from '@/lib/leagues/rosterForTeam'
import { prisma } from "@/lib/prisma"
import type { SlotOrderEntry } from "@/lib/live-draft-engine/types"

export async function resolveLeagueTeamIdFromDraftRosterId(leagueId: string, draftRosterId: string): Promise<string | null> {
  const direct = await prisma.leagueTeam.findFirst({
    where: { leagueId, id: draftRosterId },
    select: { id: true },
  })
  if (direct) return direct.id

  const roster = await prisma.roster.findFirst({
    where: { leagueId, id: draftRosterId },
    select: { platformUserId: true },
  })
  if (!roster?.platformUserId) return null

  const team = await prisma.leagueTeam.findFirst({
    where: { leagueId, platformUserId: roster.platformUserId },
    select: { id: true },
  })
  return team?.id ?? null
}

/** Id used in `DraftSession.slotOrder[].rosterId` for this league team. */
export async function resolveDraftRosterIdForLeagueTeam(leagueId: string, leagueTeamId: string): Promise<string | null> {
  const session = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: { slotOrder: true },
  })
  const slotOrder = (session?.slotOrder as unknown as SlotOrderEntry[]) ?? []
  const hit = slotOrder.find((s) => s.rosterId === leagueTeamId)
  if (hit) return hit.rosterId

  const team = await prisma.leagueTeam.findFirst({
    where: { leagueId, id: leagueTeamId },
    select: { platformUserId: true },
  })
  if (!team?.platformUserId) return null

  /* Contract-aware — see lib/leagues/rosterForTeam.ts. */
  const roster = await findRosterForTeam(leagueId, team.platformUserId)
  return roster?.id ?? null
}

export async function listDraftRosterIdsForAiManagedTeams(leagueId: string): Promise<string[]> {
  const rows = await prisma.aiOpponentTeamAssignment.findMany({
    where: { leagueId, paused: false },
    select: { leagueTeamId: true },
  })
  const out: string[] = []
  for (const r of rows) {
    const rid = await resolveDraftRosterIdForLeagueTeam(leagueId, r.leagueTeamId)
    if (rid) out.push(rid)
  }
  return [...new Set(out)]
}
