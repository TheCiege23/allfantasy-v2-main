/**
 * Roster assignment: after a pick (or on draft complete), update roster state.
 * Draft picks are stored in DraftPick; this service appends to Roster.playerData or
 * a draft snapshot for "current drafted roster view" and final persist on completion.
 */

import { prisma } from '@/lib/prisma'
import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'
import { buildLineupSectionsFromPicks } from '@/lib/post-draft/buildStartersFromPicks'
import { buildPlayerDataFromSections } from '@/lib/roster/LineupTemplateValidation'
import { getLeagueDraftTemplatePayload } from '@/lib/league/league-draft-template-payload'

export interface AssignedPlayer {
  playerName: string
  position: string
  team?: string | null
  playerId?: string | null
  byeWeek?: number | null
}

function hasExistingLineup(playerData: unknown): boolean {
  if (!playerData || typeof playerData !== 'object') return false
  const data = playerData as Record<string, unknown>
  const starters = data.starters
  if (Array.isArray(starters) && starters.some((s) => typeof s === 'string' && s.trim().length > 0)) {
    return true
  }
  const sections = data.lineup_sections
  if (sections && typeof sections === 'object' && !Array.isArray(sections)) {
    const starterList = (sections as Record<string, unknown>).starters
    if (Array.isArray(starterList) && starterList.length > 0) return true
  }
  return false
}

/**
 * Append a single pick to the roster's draft snapshot (in-memory or stored).
 * For "current drafted roster view" the client can derive from picks by rosterId.
 * Optional: persist a draft_roster_snapshot JSON on League or Roster for quick read.
 */
export async function appendPickToRosterDraftSnapshot(
  leagueId: string,
  rosterId: string,
  player: AssignedPlayer
): Promise<void> {
  const roster = await prisma.roster.findFirst({
    where: { leagueId, id: rosterId },
  })
  if (!roster) return
  const data = (roster.playerData as Record<string, unknown>) ?? {}
  const draftPicks = (data.draftPicks as AssignedPlayer[]) ?? []
  draftPicks.push(player)
  await prisma.roster.update({
    where: { id: rosterId },
    data: { playerData: { ...data, draftPicks } },
  })
}

/** Roll-up counts from {@link finalizeRosterAssignments} (idempotent sync). */
export type FinalizeRosterAssignmentsSummary = {
  teamsSynced: number
  playersSynced: number
  skippedPlayers: number
  missingRosterRows: number
}

const EMPTY_FINALIZE_SUMMARY: FinalizeRosterAssignmentsSummary = {
  teamsSynced: 0,
  playersSynced: 0,
  skippedPlayers: 0,
  missingRosterRows: 0,
}

/**
 * On draft completion: merge draft picks into each roster's playerData AND
 * materialize a starter/bench lineup using the league's sport-aware roster
 * template. Greedy fill in draft order with FLEX/SUPERFLEX spillover; writes
 * both the legacy `starters` id list and the structured `lineup_sections`
 * block so `lib/scoring/scoring-engine.ts:extractStarterIds` can score week 1.
 *
 * Existing lineups (manual edits, prior materialization) are NOT overwritten —
 * this is safe to re-run idempotently.
 */
export async function finalizeRosterAssignments(
  leagueId: string,
  draftId?: string,
): Promise<FinalizeRosterAssignmentsSummary> {
  const session = await prisma.draftSession.findFirst({
    where: { leagueId, ...(draftId ? { id: draftId } : {}) },
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!session || session.status !== 'completed') return EMPTY_FINALIZE_SUMMARY

  const rosterPayload = await getLeagueDraftTemplatePayload(leagueId).catch(() => null)
  const rosterTemplate = rosterPayload?.template ?? null

  let skippedPlayers = 0
  const byRoster = new Map<string, AssignedPlayer[]>()
  for (const p of session.picks) {
    if (
      isDraftPickRowEmpty({
        playerName: p.playerName,
        position: p.position,
        pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
      })
    ) {
      skippedPlayers += 1
      continue
    }
    const list = byRoster.get(p.rosterId) ?? []
    list.push({
      playerName: p.playerName,
      position: p.position,
      team: p.team,
      playerId: p.playerId,
      byeWeek: p.byeWeek,
    })
    byRoster.set(p.rosterId, list)
  }

  const playersSynced = [...byRoster.values()].reduce((acc, list) => acc + list.length, 0)
  let teamsSynced = 0
  let missingRosterRows = 0

  for (const [rosterId, players] of byRoster) {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, id: rosterId },
    })
    if (!roster) {
      missingRosterRows += 1
      continue
    }
    const data = (roster.playerData as Record<string, unknown>) ?? {}

    // Always refresh the flat draftPicks audit trail.
    let nextPlayerData: Record<string, unknown> = { ...data, draftPicks: players }

    // Only materialize a starter lineup when the roster doesn't already have
    // one — commissioner manual edits or a re-run of finalization must not
    // clobber user-configured lineups.
    if (rosterTemplate && !hasExistingLineup(data)) {
      const sections = buildLineupSectionsFromPicks(
        players.map((p) => ({
          playerId: p.playerId ?? null,
          playerName: p.playerName,
          position: p.position,
          team: p.team ?? null,
        })),
        rosterTemplate,
      )
      nextPlayerData = {
        ...buildPlayerDataFromSections(nextPlayerData, sections),
        draftPicks: players,
      }
    }

    await prisma.roster.update({
      where: { id: rosterId },
      data: { playerData: nextPlayerData },
    })
    teamsSynced += 1
  }

  return { teamsSynced, playersSynced, skippedPlayers, missingRosterRows }
}
