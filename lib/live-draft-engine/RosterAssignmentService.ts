import { isSeasonTournamentDraft } from '@/lib/tournament/seasonDraftMutationGate'
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
  assetType?: string | null
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
  if (await isSeasonTournamentDraft(leagueId)) return
  const roster = await prisma.roster.findFirst({
    where: { leagueId, id: rosterId },
  })
  if (!roster) return
  const data = (roster.playerData as Record<string, unknown>) ?? {}
  const draftPicks = Array.isArray(data.draftPicks) ? (data.draftPicks as AssignedPlayer[]) : []
  // Completion can materialize the final pick before a caller appends its live snapshot.
  if (draftPicks.some((existing) => playerKey(existing) === playerKey(player))) return
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
  if (await isSeasonTournamentDraft(leagueId)) return EMPTY_FINALIZE_SUMMARY
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
      assetType: p.assetType,
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

    const collegePlayers = players.filter(isNbaCollegePick)
    const proPlayers = players.filter((p) => !isNbaCollegePick(p))
    // Always refresh the flat draftPicks audit trail.
    let nextPlayerData: Record<string, unknown> = { ...data, draftPicks: players }

    // Only materialize a starter lineup when the roster doesn't already have
    // one from THIS draft — commissioner manual edits or a re-run of
    // finalization must not clobber user-configured lineups.
    const builtBy = typeof data.lineup_draft_session_id === 'string' ? data.lineup_draft_session_id : null
    const lineupFromAnotherDraft = builtBy ? builtBy !== session.id : hasEarlierDraft
    if (rosterTemplate && (!hasExistingLineup(data) || lineupFromAnotherDraft)) {
      const sections = buildLineupSectionsFromPicks(
        proPlayers.map((p) => ({
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

    nextPlayerData = mergeNbaCollegeDraftPlayers(nextPlayerData, collegePlayers)
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

function isNbaCollegePick(player: AssignedPlayer): boolean {
  return /^espn:ncaab:\d+$/.test(String(player.playerId ?? '')) && (player.assetType === 'c2c_college' || player.assetType === 'devy_pick')
}

/** Keep drafted college assets in the devy section, never in pro starter or bench slots. */
export function mergeNbaCollegeDraftPlayers(data: Record<string, unknown>, players: AssignedPlayer[]): Record<string, unknown> {
  const college = players.filter(isNbaCollegePick)
  if (!college.length) return data
  const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const sections = { ...record(data.lineup_sections) }
  const idOf = (item: unknown) => typeof item === 'string' ? item : String(record(item).id ?? record(item).player_id ?? '')
  const ids = new Set(college.map((p) => String(p.playerId)))
  for (const section of ['starters', 'bench', 'ir', 'taxi']) {
    if (Array.isArray(sections[section])) sections[section] = (sections[section] as unknown[]).filter((item) => !ids.has(idOf(item)))
  }
  const devy = Array.isArray(sections.devy) ? [...sections.devy] : []
  const existing = new Set(devy.map(idOf))
  for (const p of college) if (!existing.has(String(p.playerId))) {
    devy.push({ id: p.playerId, name: p.playerName, position: p.position, team: p.team ?? null })
    existing.add(String(p.playerId))
  }
  sections.devy = devy
  const allPlayers = Array.isArray(data.players) ? data.players.map(String) : []
  const oldDevy = Array.isArray(data.devy) ? data.devy.map(String) : []
  const starters = Array.isArray(data.starters) ? data.starters.filter((item) => !ids.has(idOf(item))) : data.starters
  return { ...data, lineup_sections: sections, players: [...new Set([...allPlayers, ...ids])], devy: [...new Set([...oldDevy, ...ids])], ...(starters === undefined ? {} : { starters }) }
}

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
    for (const entries of Object.values(sections)) {
      if (Array.isArray(entries)) for (const entry of entries) if (entry?.id) listed.add(String(entry.id))
    }
    const bench = [...(sections.bench ?? [])]
    // A live snapshot may already contain the pick before completion; it still needs a lineup slot.
    for (const p of players.filter((p) => !isNbaCollegePick(p))) {
      const id = String(p.playerId ?? '').trim()
      if (!id || listed.has(id)) continue
      bench.push({ id, name: p.playerName, position: String(p.position || 'UTIL').toUpperCase(), team: p.team ?? null })
      listed.add(id)
    }
    return mergeNbaCollegeDraftPlayers({
      ...buildPlayerDataFromSections(next, {
        starters: sections.starters ?? [],
        bench,
        ir: sections.ir ?? [],
        taxi: sections.taxi ?? [],
        devy: sections.devy ?? [],
      }),
      draftPicks,
    }, added)
  }

  if (rosterTemplate) {
    const sections = buildLineupSectionsFromPicks(
      draftPicks.filter((p) => !isNbaCollegePick(p)).map((p) => ({
        playerId: p.playerId ?? null,
        playerName: p.playerName,
        position: p.position,
        team: p.team ?? null,
      })),
      rosterTemplate,
    )
    return mergeNbaCollegeDraftPlayers({ ...buildPlayerDataFromSections(next, sections), draftPicks }, added)
  }
  return mergeNbaCollegeDraftPlayers(next, added)
}
