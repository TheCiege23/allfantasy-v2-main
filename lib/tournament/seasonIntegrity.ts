import 'server-only'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { assessLeagueJoinRisk, canonicalUserPair } from '@/lib/identity/DuplicateManagerRiskService'
import { prisma } from '@/lib/prisma'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { isSeasonLiveStaff } from './tournamentPermissions'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { lockSeasonShell } from './seasonRounds'

const id = z.string().min(1).max(200)
const reason = z.string().trim().min(8).max(500)
const actions = z.discriminatedUnion('action', [
  z.object({ action: z.literal('flag'), leagueId: id, rosterId: id,
    type: z.enum(['collusion', 'duplicate_manager', 'roster_dumping', 'suspicious_trade']), reason }).strict(),
  z.object({ action: z.literal('review'), flagId: id, reason }).strict(),
  z.object({ action: z.literal('scan_identity'), leagueId: id, rosterId: id }).strict(),
])
const open = ['open', 'flagged']
const hidden = () => new BlueprintOperationError('Tournament integrity is unavailable.', 404)

async function access(db: Prisma.TransactionClient, tournamentId: string, userId: string, write: boolean) {
  if (write) await lockSeasonShell(db, tournamentId)
  const shell = await db.tournamentShell.findFirst({
    where: { id: tournamentId, auditLogs: { some: { action: 'season_rules_published' } } },
    select: { commissionerId: true },
  })
  if (!shell) throw hidden()
  if (shell.commissionerId === userId) return true
  const grant = await db.tournamentShellGrant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })
  if (!isSeasonLiveStaff(grant)) throw hidden()
  return false
}

export async function loadSeasonIntegrity(tournamentId: string, userId: string) {
  const isOwner = await access(prisma, tournamentId, userId, false)
  const bindings = await prisma.tournamentLeague.findMany({
    where: { tournamentId, leagueId: { not: null } },
    orderBy: [{ round: { roundNumber: 'desc' } }, { name: 'asc' }],
    select: { leagueId: true, name: true, round: { select: { roundNumber: true } },
      participants: { select: { redraftRosterId: true, participant: { select: { displayName: true } } } } },
  })
  const leagues = bindings.map(row => ({
    id: row.leagueId!, name: row.name, stage: row.round.roundNumber,
    teams: row.participants.flatMap(team => team.redraftRosterId ? [{ id: team.redraftRosterId, name: team.participant.displayName }] : []),
  }))
  const flags = await prisma.integrityFlag.findMany({
    where: { leagueId: { in: leagues.map(league => league.id) }, status: { in: [...open, 'reviewed'] } },
    orderBy: [{ reviewedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }], take: 100,
    select: { id: true, leagueId: true, flagType: true, severity: true, status: true, affectedTeamNames: true,
      summary: true, commissionerNote: true, tradeTransactionId: true },
  })
  return { isOwner, leagues, flags }
}

export async function updateSeasonIntegrity(tournamentId: string, userId: string, input: unknown) {
  const event = actions.parse(input)
  await prisma.$transaction(async tx => {
    const isOwner = await access(tx, tournamentId, userId, true)
    if (event.action === 'review') {
      if (!isOwner) throw hidden()
      const flag = await tx.integrityFlag.findUnique({ where: { id: event.flagId }, select: { leagueId: true } })
      if (!flag || !await tx.tournamentLeague.findFirst({ where: { tournamentId, leagueId: flag.leagueId } })) throw hidden()
      await tx.integrityFlag.updateMany({
        where: { id: event.flagId, status: { in: open } },
        data: { status: 'reviewed', commissionerNote: event.reason, commissionerUserId: userId, reviewedAt: new Date() },
      })
      return
    }
    const assignment = await tx.tournamentLeagueParticipant.findFirst({
      where: { redraftRosterId: event.rosterId, league: { tournamentId, leagueId: event.leagueId } },
      select: { participant: { select: { displayName: true, userId: true } } },
    })
    if (!assignment) throw hidden()
    const { displayName, userId: managerId } = assignment.participant
    if (event.action === 'scan_identity') {
      const assessment = await assessLeagueJoinRisk({ leagueId: event.leagueId, joiningUserId: managerId, client: tx })
      for (const match of assessment.comparisons.filter(row => row.riskLevel === 'high' && !row.householdExempt)) {
        const pair = canonicalUserPair(managerId, match.suspectAppUserId)
        const id = seasonResourceId(event.leagueId, JSON.stringify(['duplicate_manager', pair]))
        await tx.integrityFlag.upsert({
          where: { id }, update: {},
          create: { id, leagueId: event.leagueId, flagType: 'duplicate_manager', status: 'open', severity: match.riskLevel,
            affectedRosterIds: [event.rosterId, ...(match.suspectRosterId ? [match.suspectRosterId] : [])],
            affectedTeamNames: [displayName, match.suspectLabel], summary: match.reasons.join(' · '),
            evidenceJson: { source: 'duplicate_manager_risk', reasons: match.reasons, score: match.score }, aiConfidence: 0 },
        })
      }
      return
    }
    const flagId = seasonResourceId(tournamentId, JSON.stringify([event.leagueId, event.rosterId, event.type, event.reason]))
    await tx.integrityFlag.upsert({
      where: { id: flagId }, update: {},
      create: { id: flagId, leagueId: event.leagueId, flagType: event.type, severity: 'medium', status: 'open',
        affectedRosterIds: [event.rosterId], affectedTeamNames: [displayName], summary: event.reason,
        evidenceJson: { source: 'staff_report', reportedBy: userId }, aiConfidence: 0 },
    })
  }, { timeout: 15_000 })
}

export type SeasonIntegrityView = Awaited<ReturnType<typeof loadSeasonIntegrity>>
