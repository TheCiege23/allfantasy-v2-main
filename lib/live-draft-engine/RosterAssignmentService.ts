/**
 * Roster assignment: after a pick (or on draft complete), update roster state.
 * Draft picks are stored in DraftPick; this service appends to Roster.playerData or
 * a draft snapshot for "current drafted roster view" and final persist on completion.
 */

import { prisma } from '@/lib/prisma'
import { isDraftPickRowEmpty, isDraftPickSkipped } from '@/lib/live-draft-engine/draftPickEmpty'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { buildLineupSectionsFromPicks } from '@/lib/post-draft/buildStartersFromPicks'
import { buildPlayerDataFromSections } from '@/lib/roster/LineupTemplateValidation'
import { getLeagueDraftTemplatePayload } from '@/lib/league/league-draft-template-payload'
import { toPrismaJsonInput } from '@/lib/prisma-json'

export interface AssignedPlayer {
  playerName: string
  position: string
  team?: string | null
  playerId?: string | null
  byeWeek?: number | null
}

export function hasExistingLineup(playerData: unknown): boolean {
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
    data: { playerData: toPrismaJsonInput({ ...data, draftPicks }) },
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
  // A league can hold several drafts; without an order this took whichever row Postgres returned.
  const session = await prisma.draftSession.findFirst({
    where: { leagueId, ...(draftId ? { id: draftId } : {}) },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!session || session.status !== 'completed') return EMPTY_FINALIZE_SUMMARY

  const rosterPayload = await getLeagueDraftTemplatePayload(leagueId).catch(() => null)
  const rosterTemplate = rosterPayload?.template ?? null

  let skippedPlayers = 0
  const byRoster = new Map<string, AssignedPlayer[]>()
  for (const p of session.picks) {
    if (
      isDraftPickSkipped(p) ||
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

  /*
   * 🛑 A LEAGUE'S SECOND DRAFT IS NOT A RE-RUN OF ITS FIRST.
   * "Keep an existing lineup" protects manual edits when this same draft is finalized again — but
   * it also kept LAST YEAR's lineup through a keeper league's year-two draft, and a rookie
   * draft's picks replaced `draftPicks` (the roster fallback) with four rookies. So:
   *   - a follow-up draft (rookie / supplemental / dispersal) ADDS its players to the roster;
   *   - a full draft rebuilds the lineup when it is a different draft from the one that built it.
   */
  const followUp = FOLLOW_UP_DRAFT_LABELS.has(String(session.draftModeLabel ?? '').toLowerCase())
  let hasEarlierDraft = false
  try {
    hasEarlierDraft =
      (await prisma.draftSession.count({
        where: { leagueId, status: 'completed', createdAt: { lt: session.createdAt } },
      })) > 0
  } catch {
    // Unknown: keep the long-standing behaviour (an existing lineup is kept).
  }

  for (const [rosterId, players] of byRoster) {
    const roster = await prisma.roster.findFirst({
      where: { leagueId, id: rosterId },
    })
    if (!roster) {
      missingRosterRows += 1
      continue
    }
    const data = (roster.playerData as Record<string, unknown>) ?? {}

    if (followUp) {
      await prisma.roster.update({
        where: { id: rosterId },
        data: { playerData: toPrismaJsonInput(addFollowUpDraftPlayers(data, players, rosterTemplate)) },
      })
      teamsSynced += 1
      continue
    }

    // Always refresh the flat draftPicks audit trail.
    let nextPlayerData: Record<string, unknown> = { ...data, draftPicks: players }

    // Only materialize a starter lineup when the roster doesn't already have
    // one from THIS draft — commissioner manual edits or a re-run of
    // finalization must not clobber user-configured lineups.
    const builtBy = typeof data.lineup_draft_session_id === 'string' ? data.lineup_draft_session_id : null
    const lineupFromAnotherDraft = builtBy ? builtBy !== session.id : hasEarlierDraft
    if (rosterTemplate && (!hasExistingLineup(data) || lineupFromAnotherDraft)) {
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
        lineup_draft_session_id: session.id,
      }
    }

    await prisma.roster.update({
      where: { id: rosterId },
      data: { playerData: toPrismaJsonInput(nextPlayerData) },
    })
    teamsSynced += 1
  }

  return { teamsSynced, playersSynced, skippedPlayers, missingRosterRows }
}

/** Drafts that add to rosters a league already has, rather than building them. */
const FOLLOW_UP_DRAFT_LABELS = new Set(['rookie', 'supplemental', 'dispersal'])

function playerKey(p: { playerId?: string | null; playerName?: string | null; position?: string | null }): string {
  const id = String(p.playerId ?? '').trim()
  if (id) return `id:${id}`
  return `name:${String(p.playerName ?? '').trim().toLowerCase()}|${String(p.position ?? '').trim().toUpperCase()}`
}

/**
 * A follow-up draft's picks join the roster: appended to `draftPicks` (the roster fallback) and
 * to the bench of an existing lineup. Idempotent — a player already there is not added twice, so
 * finalizing the same draft again changes nothing.
 */
export function addFollowUpDraftPlayers(
  playerData: Record<string, unknown>,
  players: AssignedPlayer[],
  rosterTemplate: Parameters<typeof buildLineupSectionsFromPicks>[1] | null,
): Record<string, unknown> {
  const previousPicks = Array.isArray(playerData.draftPicks) ? (playerData.draftPicks as AssignedPlayer[]) : []
  const known = new Set(previousPicks.map(playerKey))
  const added = players.filter((p) => !known.has(playerKey(p)))
  const draftPicks = [...previousPicks, ...added]
  const next: Record<string, unknown> = { ...playerData, draftPicks }

  if (hasExistingLineup(playerData)) {
    const raw = playerData.lineup_sections
    const sections =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, Array<Record<string, unknown>>>)
        : {}
    const listed = new Set(Array.isArray(playerData.players) ? (playerData.players as unknown[]).map(String) : [])
    const bench = [...(sections.bench ?? [])]
    for (const p of added) {
      const id = String(p.playerId ?? '').trim()
      if (!id || listed.has(id)) continue
      bench.push({ id, name: p.playerName, position: String(p.position || 'UTIL').toUpperCase(), team: p.team ?? null })
      listed.add(id)
    }
    return {
      ...buildPlayerDataFromSections(next, {
        starters: sections.starters ?? [],
        bench,
        ir: sections.ir ?? [],
        taxi: sections.taxi ?? [],
        devy: sections.devy ?? [],
      }),
      draftPicks,
    }
  }

  if (rosterTemplate) {
    const sections = buildLineupSectionsFromPicks(
      draftPicks.map((p) => ({
        playerId: p.playerId ?? null,
        playerName: p.playerName,
        position: p.position,
        team: p.team ?? null,
      })),
      rosterTemplate,
    )
    return { ...buildPlayerDataFromSections(next, sections), draftPicks }
  }
  return next
}
