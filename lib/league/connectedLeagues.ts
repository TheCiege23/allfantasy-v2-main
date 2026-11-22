/**
 * Connected leagues (owner's page review #16, Phase C4): the leagues that share one game with this one,
 * for the Commissioner Hub's "Connected leagues" pop-up.
 *
 * Three kinds of connection exist in the schema, each with its own owner check:
 *
 *   survivor    Main Island + Exile Island — `SurvivorExileLeague { mainLeagueId, exileLeagueId }`.
 *               Both leagues belong to the same commissioner (lib/survivor/SurvivorExileEngine.ts).
 *   tournament  a tournament shell (`TournamentLeague` → `TournamentShell`, owner `commissionerId`) or a
 *               legacy tournament (`LegacyTournamentLeague` → `LegacyTournament`, owner `creatorId`).
 *               A shell lists the leagues of this league's ROUND: those are the drafts that run together.
 *   zombie      a Zombie universe (`ZombieLeague.universeId` → `ZombieUniverse`, owner
 *               `commissionedByUserId ?? createdByUserId`).
 *
 * Read-only. The one cross-league action the pop-up offers — schedule every draft at once — is the
 * group's own existing route (POST /api/tournament/draft, POST /api/zombie/universe/[id]/draft-schedule),
 * and it is offered only to the group's owner, because those routes refuse anyone else.
 */
import { prisma } from '@/lib/prisma'

export type ConnectedLeague = {
  /** Null for a tournament league not created yet (a forming slot). */
  leagueId: string | null
  name: string
  /** "Main Island", "Exile Island", a zombie level, a tournament round. */
  role: string | null
  status: string | null
  draftAt: string | null
  current: boolean
}

export type ConnectedDraftSchedule =
  | { kind: 'tournament'; tournamentId: string; roundNumber: number }
  | { kind: 'zombie'; universeId: string }

export type ConnectedGroup = {
  kind: 'survivor' | 'tournament' | 'zombie'
  name: string
  /** The group's own hub, where everything else about it is run. */
  hubHref: string
  /** The viewer owns the group (not just this league), so the group-wide action is theirs. */
  isGroupOwner: boolean
  leagues: ConnectedLeague[]
  /** Set when the group can schedule every draft at once and the viewer may do it. */
  draftSchedule: ConnectedDraftSchedule | null
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

async function leagueNames(ids: string[]): Promise<Map<string, { name: string | null; status: string | null }>> {
  if (!ids.length) return new Map()
  const rows = await prisma.league.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, status: true } })
  return new Map(rows.map((r) => [r.id, { name: r.name ?? null, status: r.status ?? null }]))
}

async function survivorGroup(leagueId: string): Promise<ConnectedGroup | null> {
  const link = await prisma.survivorExileLeague.findFirst({
    where: { OR: [{ mainLeagueId: leagueId }, { exileLeagueId: leagueId }] },
    select: { mainLeagueId: true, exileLeagueId: true },
  })
  if (!link) return null
  const names = await leagueNames([link.mainLeagueId, link.exileLeagueId])
  const main = names.get(link.mainLeagueId)
  const exile = names.get(link.exileLeagueId)
  return {
    kind: 'survivor',
    name: main?.name ?? 'Survivor',
    hubHref: `/survivor/${encodeURIComponent(link.mainLeagueId)}/commissioner`,
    isGroupOwner: true,
    leagues: [
      { leagueId: link.mainLeagueId, name: main?.name ?? 'Main Island', role: 'Main Island', status: main?.status ?? null, draftAt: null, current: link.mainLeagueId === leagueId },
      { leagueId: link.exileLeagueId, name: exile?.name ?? 'Exile Island', role: 'Exile Island', status: exile?.status ?? null, draftAt: null, current: link.exileLeagueId === leagueId },
    ],
    draftSchedule: null,
  }
}

async function tournamentShellGroup(leagueId: string, userId: string): Promise<ConnectedGroup | null> {
  const mine = await prisma.tournamentLeague.findUnique({ where: { leagueId }, select: { tournamentId: true, roundId: true } })
  if (!mine) return null
  const [shell, round] = await Promise.all([
    prisma.tournamentShell.findUnique({ where: { id: mine.tournamentId }, select: { id: true, name: true, commissionerId: true } }),
    prisma.tournamentRound.findUnique({ where: { id: mine.roundId }, select: { roundNumber: true } }),
  ])
  if (!shell) return null
  const rows = await prisma.tournamentLeague.findMany({
    where: { tournamentId: shell.id, roundId: mine.roundId },
    select: { name: true, leagueId: true, status: true, draftScheduledAt: true },
    orderBy: { name: 'asc' },
  })
  const owner = shell.commissionerId === userId
  const roundLabel = round ? `Round ${round.roundNumber}` : null
  return {
    kind: 'tournament',
    name: shell.name,
    hubHref: `/tournament/${encodeURIComponent(shell.id)}`,
    isGroupOwner: owner,
    leagues: rows.map((r) => ({ leagueId: r.leagueId, name: r.name, role: roundLabel, status: r.status, draftAt: iso(r.draftScheduledAt), current: r.leagueId === leagueId })),
    draftSchedule: owner && round ? { kind: 'tournament', tournamentId: shell.id, roundNumber: round.roundNumber } : null,
  }
}

async function legacyTournamentGroup(leagueId: string, userId: string): Promise<ConnectedGroup | null> {
  const mine = await prisma.legacyTournamentLeague.findUnique({ where: { leagueId }, select: { tournamentId: true } })
  if (!mine) return null
  const t = await prisma.legacyTournament.findUnique({ where: { id: mine.tournamentId }, select: { id: true, name: true, creatorId: true } })
  if (!t) return null
  const rows = await prisma.legacyTournamentLeague.findMany({ where: { tournamentId: t.id }, select: { leagueId: true } })
  const names = await leagueNames(rows.map((r) => r.leagueId))
  return {
    kind: 'tournament',
    name: t.name,
    hubHref: `/tournament/${encodeURIComponent(t.id)}`,
    isGroupOwner: t.creatorId === userId,
    leagues: rows
      .map((r) => ({ leagueId: r.leagueId, name: names.get(r.leagueId)?.name ?? 'League', role: null, status: names.get(r.leagueId)?.status ?? null, draftAt: null, current: r.leagueId === leagueId }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    // The legacy tournament schedules drafts league by league from its own control console.
    draftSchedule: null,
  }
}

async function zombieGroup(leagueId: string, userId: string): Promise<ConnectedGroup | null> {
  const mine = await prisma.zombieLeague.findUnique({ where: { leagueId }, select: { universeId: true } })
  if (!mine?.universeId) return null
  const u = await prisma.zombieUniverse.findUnique({
    where: { id: mine.universeId },
    select: { id: true, name: true, commissionedByUserId: true, createdByUserId: true },
  })
  if (!u) return null
  const rows = await prisma.zombieLeague.findMany({
    where: { universeId: u.id },
    select: { leagueId: true, name: true, status: true, draftScheduledAt: true, level: { select: { name: true, rankOrder: true } } },
  })
  const names = await leagueNames(rows.filter((r) => !r.name).map((r) => r.leagueId))
  const owner = (u.commissionedByUserId ?? u.createdByUserId ?? null) === userId
  return {
    kind: 'zombie',
    name: u.name,
    hubHref: `/zombie/universe/${encodeURIComponent(u.id)}`,
    isGroupOwner: owner,
    leagues: rows
      .sort((a, b) => (a.level?.rankOrder ?? 99) - (b.level?.rankOrder ?? 99) || String(a.name ?? '').localeCompare(String(b.name ?? '')))
      .map((r) => ({
        leagueId: r.leagueId,
        name: r.name ?? names.get(r.leagueId)?.name ?? 'League',
        role: r.level?.name ?? null,
        status: r.status,
        draftAt: iso(r.draftScheduledAt),
        current: r.leagueId === leagueId,
      })),
    draftSchedule: owner ? { kind: 'zombie', universeId: u.id } : null,
  }
}

/**
 * This league's connected group, or null when it stands alone. A group of one (a tournament round with
 * only this league, a universe of one) is still returned: it is real, and the pop-up says so.
 */
export async function readConnectedGroup(leagueId: string, userId: string): Promise<ConnectedGroup | null> {
  return (
    (await survivorGroup(leagueId)) ??
    (await tournamentShellGroup(leagueId, userId)) ??
    (await legacyTournamentGroup(leagueId, userId)) ??
    (await zombieGroup(leagueId, userId))
  )
}
