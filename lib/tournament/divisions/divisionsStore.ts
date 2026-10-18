/**
 * DB-first persistence for the divisions & conferences format.
 *
 * Writes: a `TournamentShell` with `format: 'divisions'`, two `TournamentDivision`
 * rows ({ name, sideId, emblem }), one `TournamentConference` per conference
 * ({ name, imagePath }) and an audit-log row holding the full plan.
 * Reads: the conference leagues (`TournamentLeague.divisionId` + `conferenceId`) and
 * their participants' records, fed straight into the pure engine via `buildHubView`.
 *
 * ⚠ Nothing here calls a provider. Records come from `TournamentLeagueParticipant`,
 * which the existing weekly scoring writes.
 */
import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { can } from '@/lib/tournament/tournamentPermissions'
import { buildDivisionsBlueprint, type DivisionsBlueprint } from './blueprint'
import { buildHubView, type HubTeamInput, type HubView } from './hubView'
import { defaultFormatSettings, type FormatSettings } from './engine'
import { presetIdentity, type DivisionIdentity } from './identity'

export const DIVISIONS_FORMAT = 'divisions'
const CONFIG_ACTIONS = ['divisions_blueprint_created', 'divisions_blueprint_updated']

export class DivisionsOperationError extends Error {
  constructor(message: string, public readonly status: 403 | 404 | 409) {
    super(message)
    this.name = 'DivisionsOperationError'
  }
}

const slugify = (s: string, n: number) => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'conference') + '-' + n

function shellFields(config: DivisionsBlueprint, calendarLastWeek: number, bracketSize: number) {
  const s = config.settings
  return {
    name: config.name, sport: s.sport, format: DIVISIONS_FORMAT, formatSettings: s as unknown as Prisma.InputJsonValue,
    maxParticipants: s.conferencesPerDivision * s.teamsPerConference * 2,
    conferenceCount: s.conferencesPerDivision, leaguesPerConference: 2, teamsPerLeague: s.teamsPerConference,
    namingMode: 'commissioner_custom', openingWeekStart: 1, championshipWeek: calendarLastWeek,
    totalRounds: Math.log2(bracketSize) + 1, wildcardCount: s.wildcardSpots, bubbleEnabled: false,
    tiebreakerMode: 'record_points_best_week',
  }
}

async function writeIdentity(tx: Prisma.TransactionClient, tournamentId: string, identity: DivisionIdentity) {
  for (const [i, d] of identity.divisions.entries()) {
    await tx.tournamentDivision.upsert({
      where: { tournamentId_divisionNumber: { tournamentId, divisionNumber: i + 1 } },
      create: { tournamentId, divisionNumber: i + 1, name: d.name, sideId: d.sideId, emblem: d.emblem },
      update: { name: d.name, sideId: d.sideId, emblem: d.emblem },
    })
  }
  // Slugs are unique per tournament; clear them first so a reorder cannot collide mid-update.
  await tx.tournamentConference.deleteMany({ where: { tournamentId, conferenceNumber: { gt: identity.conferences.length } } })
  const existing = await tx.tournamentConference.findMany({ where: { tournamentId }, select: { id: true } })
  for (const row of existing) await tx.tournamentConference.update({ where: { id: row.id }, data: { slug: 'tmp-' + row.id } })
  for (const [i, c] of identity.conferences.entries()) {
    await tx.tournamentConference.upsert({
      where: { tournamentId_conferenceNumber: { tournamentId, conferenceNumber: i + 1 } },
      create: { tournamentId, conferenceNumber: i + 1, name: c.name, slug: slugify(c.name, i + 1), imagePath: c.image },
      update: { name: c.name, slug: slugify(c.name, i + 1), imagePath: c.image },
    })
  }
}

export async function saveDivisionsBlueprint(userId: string, input: unknown) {
  const plan = buildDivisionsBlueprint(input)
  return prisma.$transaction(async tx => {
    const shell = await tx.tournamentShell.create({ data: {
      ...shellFields(plan.config, plan.calendar.lastWeek, plan.report.bracketSize),
      status: 'blueprint', commissionerId: userId, createdBy: userId,
    } })
    await writeIdentity(tx, shell.id, plan.config.identity)
    await tx.tournamentAuditLog.create({ data: {
      tournamentId: shell.id, action: 'divisions_blueprint_created', actorType: 'commissioner', actorId: userId,
      targetType: 'tournament', targetId: shell.id, data: plan.config as unknown as Prisma.InputJsonValue,
    } })
    return shell.id
  })
}

/** Names lock when registration opens: edits are allowed only while the tournament is a plan. */
export async function updateDivisionsBlueprint(userId: string, tournamentId: string, input: unknown) {
  const plan = buildDivisionsBlueprint(input)
  return prisma.$transaction(async tx => {
    const shell = await tx.tournamentShell.findUnique({ where: { id: tournamentId } })
    if (!shell || shell.format !== DIVISIONS_FORMAT) throw new DivisionsOperationError('Tournament plan not found.', 404)
    if (shell.status !== 'blueprint') throw new DivisionsOperationError('Names and settings lock when registration opens.', 409)
    if (shell.commissionerId !== userId) {
      const grant = await tx.tournamentShellGrant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })
      if (!can({ userId, commissionerId: shell.commissionerId, grant }, 'editSettings')) throw new DivisionsOperationError('You have read-only access to this plan.', 403)
    }
    const lock = await tx.tournamentShell.updateMany({
      where: { id: tournamentId, updatedAt: shell.updatedAt },
      data: shellFields(plan.config, plan.calendar.lastWeek, plan.report.bracketSize),
    })
    if (lock.count !== 1) throw new DivisionsOperationError('The tournament changed. Reload the latest plan before trying again.', 409)
    await writeIdentity(tx, tournamentId, plan.config.identity)
    await tx.tournamentAuditLog.create({ data: {
      tournamentId, action: 'divisions_blueprint_updated', actorType: 'commissioner', actorId: userId,
      targetType: 'tournament', targetId: tournamentId, data: plan.config as unknown as Prisma.InputJsonValue,
    } })
    return { tournamentId }
  })
}

/** Cheap probe used by the hub page to route to the right screens. */
export async function tournamentFormat(tournamentId: string): Promise<string | null> {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId }, select: { format: true } })
  return shell?.format ?? null
}

function readSettings(raw: unknown, sport: string): FormatSettings {
  const fallback = defaultFormatSettings(sport === 'NBA' ? 'NBA' : 'NFL')
  return raw && typeof raw === 'object' ? { ...fallback, ...(raw as Partial<FormatSettings>), regions: 4 } : fallback
}

/**
 * The divisions hub for one viewer. Visible to the commissioner, staff with a grant,
 * and the tournament's own participants; null otherwise (and for "no such
 * tournament", so a 404 never confirms one exists).
 */
export async function loadDivisionsHub(tournamentId: string, userId: string): Promise<(HubView & { canManage: boolean }) | null> {
  const shell = await prisma.tournamentShell.findUnique({
    where: { id: tournamentId },
    include: {
      divisions: { orderBy: { divisionNumber: 'asc' } },
      conferences: { orderBy: { conferenceNumber: 'asc' } },
    },
  })
  if (!shell || shell.format !== DIVISIONS_FORMAT) return null
  const isOwner = shell.commissionerId === userId
  const grant = isOwner ? null : await prisma.tournamentShellGrant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })
  const participant = isOwner || grant ? null : await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } }, select: { id: true } })
  if (!isOwner && !grant && !participant) return null

  const settings = readSettings(shell.formatSettings, shell.sport)
  const fallbackIdentity = presetIdentity('black-gold', Math.max(2, shell.conferences.length || settings.conferencesPerDivision))
  const identity: DivisionIdentity = {
    version: 1, presetId: null,
    divisions: [0, 1].map(i => {
      const d = shell.divisions[i]
      return d ? { name: d.name, sideId: d.sideId, emblem: d.emblem } : fallbackIdentity.divisions[i]!
    }) as DivisionIdentity['divisions'],
    conferences: shell.conferences.length
      ? shell.conferences.map(c => ({ name: c.name, image: c.imagePath ?? 'shieldstar' }))
      : fallbackIdentity.conferences,
  }

  const divisionIndex = new Map(shell.divisions.map((d, i) => [d.id, i as 0 | 1]))
  const conferenceIndex = new Map(shell.conferences.map((c, i) => [c.id, i]))
  const leagues = await prisma.tournamentLeague.findMany({
    where: { tournamentId, divisionId: { not: null }, conferenceId: { not: null } },
    select: { id: true, leagueId: true, divisionId: true, conferenceId: true, participants: {
      select: { id: true, userId: true, wins: true, losses: true, ties: true, pointsFor: true, participant: { select: { displayName: true } } },
    } },
  })
  const teams: HubTeamInput[] = []
  for (const league of leagues) {
    const d = divisionIndex.get(league.divisionId!)
    const c = conferenceIndex.get(league.conferenceId!)
    if (d === undefined || c === undefined) continue
    for (const p of league.participants) {
      teams.push({
        id: p.id, name: p.participant.displayName, userId: p.userId, conferenceId: league.conferenceId!,
        wins: p.wins, losses: p.losses, ties: p.ties, points: p.pointsFor, bestWeek: null,
        divisionIndex: d, conferenceIndex: c, leagueId: league.leagueId,
      })
    }
  }

  const view = buildHubView({
    tournament: { id: shell.id, name: shell.name, sport: settings.sport, status: shell.status, season: null },
    settings, identity, teams, meUserId: userId,
  })
  return { ...view, canManage: isOwner || Boolean(grant && can({ userId, commissionerId: shell.commissionerId, grant }, 'editSettings')) }
}

/** The latest saved plan, for re-opening the planner on a blueprint. */
export async function loadDivisionsBlueprint(tournamentId: string): Promise<DivisionsBlueprint | null> {
  const row = await prisma.tournamentAuditLog.findFirst({
    where: { tournamentId, action: { in: CONFIG_ACTIONS } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  return (row?.data as DivisionsBlueprint | undefined) ?? null
}
