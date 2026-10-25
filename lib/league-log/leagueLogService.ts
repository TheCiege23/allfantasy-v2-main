/**
 * Reads the league log (lib/league-log/leagueLog.ts) for one viewer.
 *
 *   commissioner / co-commissioner  every row, worded where the log knows the type, plus the raw row
 *   member, log visible to league   only the member-visible commissioner actions, as sentences
 *   member, log set commish only    nothing: `{ hidden: true }`
 *   not in the league               refused
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { getLeagueRole } from '@/lib/league/permissions'
import { UNDO_BLOCK_TEXT } from '@/lib/commissioner-undo/commissionerUndo'
import { readUndoStatus } from '@/lib/commissioner-undo/commissionerUndoService'
import {
  describeLogEntry,
  LOG_ACTIONS,
  MEMBER_LOG_ACTION_TYPES,
  readLeagueLogVisibility,
  rosterIdsNamedBy,
  userIdsNamedBy,
  type AuditRow,
  type LeagueLogEntry,
  type LeagueLogVisibility,
  type LogCategory,
  type LogLang,
  type LogNames,
} from './leagueLog'

export type LeagueLogResult =
  | { ok: false; status: 401 | 403 | 404 }
  | {
      ok: true
      canManage: boolean
      visibility: LeagueLogVisibility
      hidden: boolean
      entries: LeagueLogEntry[]
      nextCursor: string | null
    }

export type LeagueLogQuery = { lang?: LogLang; limit?: number; cursor?: string | null; category?: LogCategory | null }

async function lookUpNames(leagueId: string, rows: AuditRow[]): Promise<LogNames> {
  const users: Record<string, string> = {}
  const teams: Record<string, string> = {}
  const userIds = userIdsNamedBy(rows)
  const rosterIds = rosterIdsNamedBy(rows)
  const [appUsers, redraftRosters, rosters] = await Promise.all([
    userIds.length
      ? prisma.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true, username: true } })
      : Promise.resolve([]),
    rosterIds.length
      ? prisma.redraftRoster.findMany({ where: { id: { in: rosterIds }, leagueId }, select: { id: true, teamName: true, ownerName: true } })
      : Promise.resolve([]),
    // The commissioner tools that edit FAAB, waiver priority and lineups key on `Roster`, not on
    // `RedraftRoster`; their names come through the redraft link or the league team.
    rosterIds.length
      ? prisma.roster.findMany({
          where: { id: { in: rosterIds }, leagueId },
          select: { id: true, platformUserId: true, redraftRoster: { select: { teamName: true, ownerName: true } } },
        })
      : Promise.resolve([]),
  ])
  for (const u of appUsers) users[u.id] = u.displayName?.trim() || u.username
  for (const r of redraftRosters) teams[r.id] = r.teamName?.trim() || r.ownerName
  const unnamed = rosters.filter((r) => !r.redraftRoster)
  const leagueTeams = unnamed.length
    ? await prisma.leagueTeam.findMany({
        where: { leagueId, platformUserId: { in: unnamed.map((r) => r.platformUserId) } },
        select: { platformUserId: true, teamName: true, ownerName: true },
      })
    : []
  const teamByPlatform = new Map(leagueTeams.map((t) => [t.platformUserId, t.teamName?.trim() || t.ownerName]))
  for (const r of rosters) {
    const name = r.redraftRoster ? r.redraftRoster.teamName?.trim() || r.redraftRoster.ownerName : teamByPlatform.get(r.platformUserId)
    if (name) teams[r.id] = name
  }
  return { users, teams }
}

export async function readLeagueLog(leagueId: string, userId: string | null | undefined, query: LeagueLogQuery = {}): Promise<LeagueLogResult> {
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return { ok: false, status: membership.status }
  const role = await getLeagueRole(leagueId, userId!)
  const canManage = role === 'commissioner' || role === 'co_commissioner'
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const visibility = readLeagueLogVisibility(league?.settings)
  if (!canManage && visibility === 'commish_only') {
    return { ok: true, canManage, visibility, hidden: true, entries: [], nextCursor: null }
  }

  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 40)))
  let types: string[] | null = canManage ? null : [...MEMBER_LOG_ACTION_TYPES]
  if (query.category) {
    const inCategory = Object.entries(LOG_ACTIONS)
      .filter(([, a]) => a.category === query.category)
      .map(([t]) => t)
    types = types ? types.filter((t) => inCategory.includes(t)) : inCategory
  }
  const where: Prisma.LeagueAuditLogWhereInput = { leagueId, ...(types ? { actionType: { in: types } } : {}) }
  const rows = await prisma.leagueAuditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: { id: true, actionType: true, entityId: true, userId: true, beforeState: true, afterState: true, metadata: true, createdAt: true },
  })
  const page = rows.slice(0, limit)
  const names = await lookUpNames(leagueId, page)
  const lang = query.lang === 'es' ? 'es' : 'en'
  // Commissioners see whether each recent edit can still be undone; members never get the field.
  const undo = canManage ? await readUndoStatus(leagueId, page) : new Map()
  const entries = page
    .map((row) => {
      const entry = describeLogEntry(row, { lang, names, forCommissioner: canManage })
      const u = undo.get(row.id)
      if (entry && u) entry.undo = { available: u.available, reason: u.reason ? UNDO_BLOCK_TEXT[u.reason as keyof typeof UNDO_BLOCK_TEXT] : null }
      return entry
    })
    .filter((e): e is LeagueLogEntry => e !== null)
  return {
    ok: true,
    canManage,
    visibility,
    hidden: false,
    entries,
    nextCursor: rows.length > limit ? page[page.length - 1]?.id ?? null : null,
  }
}
