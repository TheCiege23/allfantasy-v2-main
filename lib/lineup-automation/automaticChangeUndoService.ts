import 'server-only'

/**
 * The league log of automatic lineup changes, and undoing one (./automaticChangeUndo.ts).
 *
 * Who: the team's owner (their own team) or the commissioner / co-commissioner (any team). An owner's
 * undo is saved as their own lineup save — so, exactly as when they set a lineup by hand, it also ends
 * AllFantasy running the team if it was. A commissioner's undo is saved as a commissioner correction.
 * Either way the lineup engine runs its checks, including that no player whose game has started moves.
 */
import { prisma } from '@/lib/prisma'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { logAction } from '@/server/services/auditService'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { hashPlayerDataSnapshot } from '@/lib/roster-lineup-engine/rosterMoveHistory'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import { readAutomaticChangeUndo, restoreLineupLayout } from './automaticChangeUndo'

export const AUTOMATIC_CHANGE_UNDONE_ACTION = 'automatic_lineup_change.undone'
const LOG_DAYS = 14
const LOG_MAX = 20

export type AutomaticChangeRow = {
  id: string
  rosterId: string
  teamName: string | null
  at: string
  message: string
  /** Undo is offered only for the latest automatic change on a lineup nobody has touched since. */
  undoable: boolean
  undone: boolean
}

type Access = { ok: true; commissioner: boolean; ownRosterId: string | null } | { ok: false; status: 403 | 404 | 409 }

async function access(leagueId: string, userId: string): Promise<Access> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  if (!league) return { ok: false, status: 404 }
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return { ok: false, status: 409 }
  const [commissioner, own] = await Promise.all([
    isElevatedCommissioner(leagueId, userId),
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }),
  ])
  if (!commissioner && !own) return { ok: false, status: 403 }
  return { ok: true, commissioner, ownRosterId: own?.id ?? null }
}

export async function readAutomaticChanges(leagueId: string, userId: string, now = new Date()): Promise<{ ok: true; rows: AutomaticChangeRow[]; commissioner: boolean } | { ok: false; status: 403 | 404 | 409 }> {
  const a = await access(leagueId, userId)
  if (!a.ok) return a
  const since = new Date(now.getTime() - LOG_DAYS * 86_400_000)
  const logRows = await prisma.automationAuditLog.findMany({
    where: { leagueId, entityType: 'roster', createdAt: { gte: since }, ...(a.commissioner ? {} : { entityId: a.ownRosterId ?? '' }) },
    orderBy: { createdAt: 'desc' },
    take: LOG_MAX,
    select: { id: true, entityId: true, createdAt: true, message: true, metadata: true },
  })
  const rosterIds = [...new Set(logRows.map((r) => r.entityId).filter((id): id is string => Boolean(id)))]
  const [rosters, undone] = await Promise.all([
    rosterIds.length ? prisma.roster.findMany({ where: { id: { in: rosterIds } }, select: { id: true, playerData: true, platformUserId: true } }) : [],
    logRows.length
      ? prisma.leagueAuditLog.findMany({ where: { leagueId, actionType: AUTOMATIC_CHANGE_UNDONE_ACTION, entityId: { in: logRows.map((r) => r.id) } }, select: { entityId: true } })
      : [],
  ])
  const teams = rosters.length
    ? await prisma.leagueTeam.findMany({ where: { leagueId, platformUserId: { in: rosters.map((r) => r.platformUserId).filter(Boolean) } }, select: { platformUserId: true, teamName: true } })
    : []
  const teamName = new Map(rosters.map((r) => [r.id, teams.find((t) => t.platformUserId === r.platformUserId)?.teamName ?? null]))
  const currentHash = new Map(rosters.map((r) => [r.id, hashPlayerDataSnapshot(r.playerData)]))
  const undoneIds = new Set(undone.map((u) => u.entityId))
  const latestSeen = new Set<string>()
  const rows = logRows
    .filter((r) => r.entityId)
    .map((r) => {
      const rosterId = r.entityId!
      const undo = readAutomaticChangeUndo(r.metadata)
      const latest = !latestSeen.has(rosterId)
      latestSeen.add(rosterId)
      return {
        id: r.id,
        rosterId,
        teamName: teamName.get(rosterId) ?? null,
        at: r.createdAt.toISOString(),
        message: r.message,
        undoable: Boolean(undo && latest && currentHash.get(rosterId) === undo.afterHash),
        undone: undoneIds.has(r.id),
      }
    })
  return { ok: true, rows, commissioner: a.commissioner }
}

export type UndoResult = { ok: true; message: string } | { ok: false; status: number; error: string }

export async function undoAutomaticChange(leagueId: string, userId: string, auditId: unknown): Promise<UndoResult> {
  if (typeof auditId !== 'string' || !auditId) return { ok: false, status: 400, error: 'Send { auditId }.' }
  const a = await access(leagueId, userId)
  if (!a.ok) return { ok: false, status: a.status, error: a.status === 404 ? 'League not found' : a.status === 409 ? 'AllFantasy only changes lineups in leagues it runs.' : 'Forbidden' }
  const row = await prisma.automationAuditLog.findFirst({ where: { id: auditId, leagueId, entityType: 'roster' }, select: { id: true, entityId: true, message: true, metadata: true } })
  if (!row?.entityId) return { ok: false, status: 404, error: 'That automatic change was not found.' }
  const owner = row.entityId === a.ownRosterId
  if (!owner && !a.commissioner) return { ok: false, status: 403, error: 'Only the team’s owner or the commissioner can undo this.' }
  const undo = readAutomaticChangeUndo(row.metadata)
  if (!undo) return { ok: false, status: 409, error: 'This change was made before undo was available, so set the lineup yourself.' }

  const roster = await prisma.roster.findUnique({ where: { id: row.entityId }, select: { id: true, playerData: true, platformUserId: true } })
  if (!roster) return { ok: false, status: 404, error: 'That team was not found.' }
  if (hashPlayerDataSnapshot(roster.playerData) !== undo.afterHash) {
    return { ok: false, status: 409, error: 'The lineup has changed since, so undoing would throw that away. Set the lineup yourself.' }
  }
  const restored = restoreLineupLayout(roster.playerData, undo.layout)
  if (!restored.ok) {
    return { ok: false, status: 409, error: restored.reason === 'players_changed' ? 'The team’s players have changed since, so set the lineup yourself.' : 'There is nothing to undo.' }
  }
  const pd = roster.playerData && typeof roster.playerData === 'object' ? (roster.playerData as Record<string, unknown>) : {}
  const saved = await persistRosterLineupWithEngine({
    leagueId,
    rosterId: roster.id,
    actorUserId: userId,
    ...(roster.platformUserId ? { expectedOwnerUserId: roster.platformUserId } : {}),
    ...(Array.isArray(pd.starters) ? { expectedStarters: pd.starters.map(String) } : {}),
    season: undo.season,
    week: undo.week,
    source: owner ? 'user_save' : 'commissioner_override',
    nextPlayerData: restored.nextPlayerData,
  })
  if (!saved.ok) return { ok: false, status: saved.status ?? 409, error: saved.error }
  await logAction({
    leagueId,
    userId,
    actionType: AUTOMATIC_CHANGE_UNDONE_ACTION,
    entityType: 'automation_audit',
    entityId: row.id,
    metadata: { rosterId: roster.id, by: owner ? 'owner' : 'commissioner', change: row.message },
  }).catch(() => {})
  return { ok: true, message: 'Undone — the players are back where they were.' }
}
