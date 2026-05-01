/**
 * NFL redraft — explicit DraftSession → persisted `Roster.playerData` sync entry point.
 * Delegates materialization to `finalizeRosterAssignments` (starter/bench from template).
 */

import { prisma } from '@/lib/prisma'
import { isNflRedraftCoreDashboardLeague } from '@/lib/league/is-nfl-redraft-core-dashboard'
import {
  finalizeRosterAssignments,
  type FinalizeRosterAssignmentsSummary,
} from '@/lib/live-draft-engine/RosterAssignmentService'
import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'
import { assertLifecycleActionAllowed } from '@/server/services/leagueLifecycleService'
import { canViewLeague, isElevatedCommissioner } from '@/server/services/permissionService'

export type DraftToRosterSyncSummary = {
  leagueId: string
  draftId: string
  teamsSynced: number
  playersSynced: number
  skippedPlayers: number
  alreadySynced: boolean
  missingRosterRows: number
}

export type DraftToRosterSyncError = {
  ok: false
  code:
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_NFL_REDRAFT_CORE'
    | 'LEAGUE_NOT_FOUND'
    | 'SESSION_NOT_FOUND'
    | 'DRAFT_NOT_COMPLETED'
    | 'LIFECYCLE_BLOCKED'
  message: string
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

async function isFullyMaterializedForSession(params: {
  leagueId: string
  sessionPicks: Array<{
    rosterId: string
    playerName: string
    position: string
    pickMetadata?: unknown | null
    playerId?: string | null
    team?: string | null
    byeWeek?: number | null
  }>
  rosterTemplatePresent: boolean
}): Promise<boolean> {
  const byRoster = new Map<
    string,
    Array<{ playerName: string; position: string; team?: string | null; playerId?: string | null; byeWeek?: number | null }>
  >()
  for (const p of params.sessionPicks) {
    if (
      isDraftPickRowEmpty({
        playerName: p.playerName,
        position: p.position,
        pickMetadata: p.pickMetadata ?? null,
      })
    ) {
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

  if (byRoster.size === 0) {
    return params.sessionPicks.every((p) =>
      isDraftPickRowEmpty({
        playerName: p.playerName,
        position: p.position,
        pickMetadata: p.pickMetadata ?? null,
      }),
    )
  }

  for (const [rosterId, expected] of byRoster) {
    const roster = await prisma.roster.findFirst({
      where: { leagueId: params.leagueId, id: rosterId },
      select: { playerData: true },
    })
    if (!roster) return false
    const data = roster.playerData as Record<string, unknown> | null
    const dp = data?.draftPicks
    if (!Array.isArray(dp) || dp.length !== expected.length) return false
    for (let i = 0; i < expected.length; i++) {
      const row = dp[i] as Record<string, unknown>
      const exp = expected[i]!
      if (String(row?.playerId ?? '').trim() !== String(exp.playerId ?? '').trim()) return false
      if (String(row?.playerName ?? '').trim() !== String(exp.playerName ?? '').trim()) return false
    }
    if (params.rosterTemplatePresent && !hasExistingLineup(roster.playerData)) {
      return false
    }
  }

  return true
}

export type DraftToRosterSyncResult = { ok: true; summary: DraftToRosterSyncSummary } | DraftToRosterSyncError

/**
 * Commissioner-only: persist completed draft picks onto `Roster.playerData` for NFL redraft core leagues.
 * Idempotent — safe to retry; does not duplicate players in lineup sections.
 */
export async function syncDraftPicksToRoster(params: {
  leagueId: string
  draftId: string
  actorUserId: string | null | undefined
}): Promise<DraftToRosterSyncResult> {
  const { leagueId, draftId, actorUserId } = params
  if (!actorUserId?.trim()) {
    return { ok: false, code: 'UNAUTHORIZED', message: 'Unauthorized' }
  }

  const [canView, elevated] = await Promise.all([
    canViewLeague(leagueId, actorUserId),
    isElevatedCommissioner(leagueId, actorUserId),
  ])
  if (!canView) {
    return { ok: false, code: 'FORBIDDEN', message: 'Forbidden' }
  }
  if (!elevated) {
    return { ok: false, code: 'FORBIDDEN', message: 'Insufficient permissions for this action.' }
  }

  const lifecycle = await assertLifecycleActionAllowed(leagueId, 'settings_edit_draft', actorUserId, {
    isElevatedCommissioner: elevated,
    commissionerOverride: elevated,
  })
  if (!lifecycle.ok) {
    return {
      ok: false,
      code: 'LIFECYCLE_BLOCKED',
      message: lifecycle.err.error,
    }
  }

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      sport: true,
      leagueType: true,
      isDynasty: true,
      leagueVariant: true,
      bestBallMode: true,
      guillotineMode: true,
      keeperPhaseActive: true,
    },
  })
  if (!league) {
    return { ok: false, code: 'LEAGUE_NOT_FOUND', message: 'League not found' }
  }

  if (
    !isNflRedraftCoreDashboardLeague({
      sport: String(league.sport),
      leagueType: league.leagueType,
      isDynasty: league.isDynasty,
      leagueVariant: league.leagueVariant,
      bestBallMode: league.bestBallMode,
      guillotineMode: league.guillotineMode,
      keeperPhaseActive: league.keeperPhaseActive,
    })
  ) {
    return {
      ok: false,
      code: 'NOT_NFL_REDRAFT_CORE',
      message: 'Draft → roster sync is only available for standard NFL redraft leagues.',
    }
  }

  const session = await prisma.draftSession.findFirst({
    where: { id: draftId, leagueId },
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!session) {
    return { ok: false, code: 'SESSION_NOT_FOUND', message: 'Draft session not found' }
  }
  if (session.status !== 'completed') {
    return { ok: false, code: 'DRAFT_NOT_COMPLETED', message: 'Draft is not completed yet' }
  }

  const { getLeagueDraftTemplatePayload } = await import('@/lib/league/league-draft-template-payload')
  const rosterPayload = await getLeagueDraftTemplatePayload(leagueId).catch(() => null)
  const rosterTemplatePresent = Boolean(rosterPayload?.template)

  const alreadySynced = await isFullyMaterializedForSession({
    leagueId,
    sessionPicks: session.picks,
    rosterTemplatePresent,
  })

  let inner: FinalizeRosterAssignmentsSummary
  if (alreadySynced) {
    inner = {
      teamsSynced: 0,
      playersSynced: [...session.picks].filter(
        (p) =>
          !isDraftPickRowEmpty({
            playerName: p.playerName,
            position: p.position,
            pickMetadata: p.pickMetadata ?? null,
          }),
      ).length,
      skippedPlayers: [...session.picks].filter((p) =>
        isDraftPickRowEmpty({
          playerName: p.playerName,
          position: p.position,
          pickMetadata: p.pickMetadata ?? null,
        }),
      ).length,
      missingRosterRows: 0,
    }
  } else {
    inner = await finalizeRosterAssignments(leagueId, draftId)
  }

  const summary: DraftToRosterSyncSummary = {
    leagueId,
    draftId,
    teamsSynced: inner.teamsSynced,
    playersSynced: inner.playersSynced,
    skippedPlayers: inner.skippedPlayers,
    alreadySynced,
    missingRosterRows: inner.missingRosterRows,
  }

  return { ok: true, summary }
}
