import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { isSeasonLiveStaff } from './tournamentPermissions'
import { seasonContractHash } from './seasonCalendarVerification'
import { readSeasonStageManifest } from './seasonNativeContract'
import { loadSeasonStage, lockSeasonShell } from './seasonRounds'
import { seasonScoringId } from './seasonDraftHandoff'
import { SEASON_CUT_FINALIZED, type SeasonCutDecision } from './seasonReportPublication'
import { analyzeSeasonScoreCorrection, applySeasonScoreCorrection, firstSeasonStageDraft, inspectSeasonStageRooms } from './seasonScoreRecovery'
import { findOpenSeasonRecoveries, newestSeasonEvent, RECOVERY_REQUESTED, RECOVERY_RESOLVED, SCORE_DELAYED, SCORE_RECOVERED, OPENING_FIELD_REOPENED } from './seasonRecoveryState'
import { recoveryReason, scoreCorrectionSchema, type RecoveryCase, type RecoveryImpact, type RecoveryMatch, type ScoreCorrection } from './seasonRecoveryContract'

type Field = NonNullable<Awaited<ReturnType<typeof loadSeasonStage>>>
type StoredCase = Omit<Extract<RecoveryCase, { kind: 'withdrawal' }>, 'id' | 'openedAt'> & { entrantId: string; fieldId: string; replacementId?: string }
  | Omit<Extract<RecoveryCase, { kind: 'correction' }>, 'id' | 'openedAt'> & { input: ScoreCorrection; revision: number }

const conflict = (message: string) => new BlueprintOperationError(message, 409)
const hidden = () => new BlueprintOperationError('Tournament recovery is unavailable.', 404)

async function ownerShell(tx: Prisma.TransactionClient, tournamentId: string, userId: string) {
  const shell = await lockSeasonShell(tx, tournamentId)
  if (!shell || shell.commissionerId !== userId) throw hidden()
  return shell
}

async function canReviewRecovery(db: Prisma.TransactionClient, tournamentId: string, userId: string, commissionerId: string) {
  if (userId === commissionerId) return true
  const grant = await db.tournamentShellGrant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })
  return isSeasonLiveStaff(grant)
}

async function pauseRecoveryDrafts(tx: Prisma.TransactionClient, tournamentId: string, stage: number, now: Date) {
  const rooms = await tx.tournamentLeague.findMany({ where: { tournamentId, round: { roundNumber: stage } }, select: { draftSessionId: true } })
  const sessions = await tx.draftSession.findMany({
    where: { id: { in: rooms.flatMap(room => room.draftSessionId ? [room.draftSessionId] : []) }, status: 'in_progress' },
  })
  for (const session of sessions) {
    const remaining = session.overnightFrozenPickSeconds ?? (session.timerEndAt
      ? Math.max(0, Math.ceil((session.timerEndAt.getTime() - now.getTime()) / 1000)) : session.timerSeconds ?? 0)
    const auction = session.draftType === 'auction' && session.auctionState && typeof session.auctionState === 'object' && !Array.isArray(session.auctionState)
      ? toPrismaJsonInput({ ...session.auctionState, bidTimerEndAt: null }) : undefined
    await tx.draftSession.update({ where: { id: session.id }, data: {
      status: 'paused', timerEndAt: null, overnightFrozenPickSeconds: null, pausedRemainingSeconds: remaining,
      pausedByUserId: null, version: { increment: 1 }, ...(auction ? { auctionState: auction } : {}),
    } })
  }
}

async function saveCase(tx: Prisma.TransactionClient, tournamentId: string, userId: string, id: string, data: StoredCase, now: Date, currentStage: number) {
  const existing = await tx.tournamentAuditLog.findFirst({ where: { id, tournamentId, action: RECOVERY_REQUESTED } })
  if (existing) return { caseId: id, reused: true }
  if ((await findOpenSeasonRecoveries(tx, tournamentId)).length) throw conflict('Resolve the open recovery case before opening another.')
  await tx.tournamentAuditLog.create({ data: {
    id, tournamentId, roundNumber: data.stage, actorType: 'user', actorId: userId, action: RECOVERY_REQUESTED,
    targetType: 'recovery', targetId: data.kind === 'withdrawal' ? data.entrantId : data.matchupId,
    createdAt: now, data: toPrismaJsonInput(data),
  } })
  await pauseRecoveryDrafts(tx, tournamentId, currentStage, now)
  return { caseId: id, reused: false }
}

async function findWithdrawalReplacement(tx: Prisma.TransactionClient, tournamentId: string, stage: number, field: Field, entrantId: string) {
  if (stage === 1) {
    const candidate = await tx.tournamentParticipant.findFirst({
      where: { tournamentId, status: 'waitlisted' }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    })
    if (!candidate) return null
    const acceptance = await tx.tournamentAuditLog.findFirst({
      where: { tournamentId, action: 'season_entry_joined', targetId: candidate.id }, orderBy: newestSeasonEvent,
    })
    const accepted = acceptance?.data as { publicationId?: string; hash?: string } | undefined
    return accepted?.publicationId === field.manifest.publicationId && accepted.hash === field.manifest.rulesHash ? candidate : null
  }

  const prior = await tx.tournamentRound.findUnique({ where: { tournamentId_roundNumber: { tournamentId, roundNumber: stage - 1 } } })
  if (!prior) return null
  const event = await tx.tournamentAuditLog.findFirst({
    where: { tournamentId, action: SEASON_CUT_FINALIZED, targetId: prior.id }, orderBy: newestSeasonEvent,
  })
  const cut = event?.data as (SeasonCutDecision & { standings: { id: string; leagueId: string }[] }) | undefined
  if (!cut) return null
  const eligible = await tx.tournamentParticipant.findMany({ where: { tournamentId, status: 'eliminated', id: { in: cut.eliminated } } })
  const byId = new Map(eligible.map(entrant => [entrant.id, entrant]))
  const seed = field.manifest.leagues.flatMap(pool => pool.members).find(member => member.id === entrantId)?.previousSeed
  const berth = cut.advancing.find(row => row.seed === seed)
  const automaticLeague = berth?.path === 'automatic' ? cut.standings.find(row => row.id === berth.entrantId)?.leagueId : undefined
  const ordered = cut.standings.filter(row => byId.has(row.id))
  const first = automaticLeague ? ordered.find(row => row.leagueId === automaticLeague) : ordered[0]
  return first ? byId.get(first.id)! : null
}

async function analyzeWithdrawal(tx: Prisma.TransactionClient, tournamentId: string, stage: number, field: Field, entrantId: string, now: Date) {
  const rooms = await inspectSeasonStageRooms(tx, tournamentId, stage)
  const beforeDraft = !rooms.rooms && now.getTime() < firstSeasonStageDraft(field)
  const replacement = beforeDraft ? await findWithdrawalReplacement(tx, tournamentId, stage, field, entrantId) : null
  const explanation = rooms.rooms ? 'Assignments have been issued. Review the withdrawal and preserve the existing rooms and picks.'
    : now.getTime() >= firstSeasonStageDraft(field) ? 'The published draft window has started.'
    : !replacement ? 'There is no eligible replacement for this seat.'
    : stage === 1 ? 'The first eligible waitlisted manager can take the same slot.'
    : 'The next eligible finisher can take the same slot and seed.'
  const impact: RecoveryImpact = { ...rooms, affectedStage: stage, eligible: !!replacement, explanation, canReopen: stage === 1 && beforeDraft && !replacement }
  return { impact, replacement }
}

export async function requestSeasonWithdrawal(userId: string, tournamentId: string, reason: string, participantId?: string, now = new Date()) {
  reason = recoveryReason.parse(reason)
  return prisma.$transaction(async tx => {
    const shell = await lockSeasonShell(tx, tournamentId)
    if (!shell || shell.status !== 'rules_published' || (participantId && shell.commissionerId !== userId)) throw hidden()
    const stage = Math.max(1, shell.currentRoundNumber)
    const entrant = await tx.tournamentParticipant.findFirst({ where: { tournamentId, ...(participantId ? { id: participantId } : { userId }) } })
    if (!entrant) throw hidden()
    const field = await loadSeasonStage(tournamentId, stage, tx)
    const member = field?.manifest.leagues.flatMap(pool => pool.members).find(row => row.id === entrant.id && row.userId === entrant.userId)
    if (!field || !member || entrant.status !== 'registered') {
      const previous = await tx.tournamentAuditLog.findFirst({
        where: { tournamentId, action: RECOVERY_REQUESTED, targetType: 'recovery', targetId: entrant.id, roundNumber: stage }, orderBy: newestSeasonEvent,
      })
      if ((previous?.data as StoredCase | undefined)?.kind === 'withdrawal') return { caseId: previous!.id, reused: true }
      throw hidden()
    }
    const id = seasonResourceId(field.id, 'withdrawal:' + entrant.id)
    if (await tx.tournamentAuditLog.findFirst({ where: { id, tournamentId, action: RECOVERY_REQUESTED } })) return { caseId: id, reused: true }
    const { impact, replacement } = await analyzeWithdrawal(tx, tournamentId, stage, field, member.id, now)
    return saveCase(tx, tournamentId, userId, id, {
      kind: 'withdrawal', stage, fieldId: field.id, entrantId: member.id, manager: member.displayName,
      reason, ownerId: shell.commissionerId, impact, ...(replacement ? { replacement: replacement.displayName, replacementId: replacement.id } : {}),
    }, now, stage)
  }, { timeout: 25_000 })
}

export async function proposeSeasonCorrection(userId: string, tournamentId: string, input: ScoreCorrection, reason: string, now = new Date()) {
  input = scoreCorrectionSchema.parse(input)
  reason = recoveryReason.parse(reason)
  return prisma.$transaction(async tx => {
    const shell = await lockSeasonShell(tx, tournamentId)
    if (!shell || !['rules_published', 'complete'].includes(shell.status) || !await canReviewRecovery(tx, tournamentId, userId, shell.commissionerId)) throw hidden()
    const existing = (await findOpenSeasonRecoveries(tx, tournamentId)).find(row => {
      const data = row.data as StoredCase
      return data.kind === 'correction' && data.matchupId === input.matchupId && data.after[0] === input.homeScore && data.after[1] === input.awayScore
    })
    if (existing) return { caseId: existing.id, reused: true }
    const previous = await tx.tournamentAuditLog.findFirst({
      where: { tournamentId, action: RECOVERY_REQUESTED, targetId: input.matchupId }, orderBy: newestSeasonEvent,
    })
    const prior = previous?.data as StoredCase | undefined
    if (previous && prior?.kind === 'correction' && prior.after[0] === input.homeScore && prior.after[1] === input.awayScore) {
      const resolved = await tx.tournamentAuditLog.findUnique({ where: { id: seasonResourceId(previous.id, 'resolution') } })
      if ((resolved?.data as { outcome?: string } | undefined)?.outcome === 'apply') {
        const score = await tx.redraftMatchup.findUnique({ where: { id: input.matchupId }, select: { homeScore: true, awayScore: true } })
        if (score?.homeScore === input.homeScore && score.awayScore === input.awayScore) return { caseId: previous.id, reused: true }
      }
    }
    const result = await analyzeSeasonScoreCorrection(tx, tournamentId, shell.currentRoundNumber, shell.status, input, now)
    const { match, snapshot, stage, impact } = result
    const revision = snapshot.revision ?? 1
    const id = seasonResourceId(match.id, JSON.stringify(['score-recovery', revision, input.homeScore, input.awayScore]))
    return saveCase(tx, tournamentId, userId, id, {
      kind: 'correction', stage, period: match.week, matchupId: match.id, home: match.homeRoster.ownerName,
      away: match.awayRoster?.ownerName ?? null, before: [match.homeScore, match.awayScore], after: [input.homeScore, input.awayScore],
      ownerId: shell.commissionerId, reason, impact, input, revision,
    }, now, shell.currentRoundNumber)
  }, { timeout: 25_000 })
}

async function applyWithdrawal(tx: Prisma.TransactionClient, tournamentId: string, id: string, data: Extract<StoredCase, { kind: 'withdrawal' }>, stage: number, now: Date) {
  const field = await loadSeasonStage(tournamentId, stage, tx)
  if (!field || stage !== data.stage || field.id !== data.fieldId) throw conflict('The frozen assignment changed. Review this case again.')
  const { impact, replacement } = await analyzeWithdrawal(tx, tournamentId, stage, field, data.entrantId, now)
  if (!impact.eligible || !replacement) throw conflict(impact.explanation)
  if (replacement.id !== data.replacementId) throw conflict('The eligible replacement changed. Keep the saved assignment and open a new review.')
  const { manifestHash: _hash, ...manifest } = field.manifest
  const payload = {
    ...manifest,
    leagues: manifest.leagues.map(pool => ({ ...pool, members: pool.members.map(member => member.id !== data.entrantId ? member : {
      ...member, id: replacement.id, userId: replacement.userId, displayName: replacement.displayName, avatarUrl: replacement.avatarUrl,
    }) })),
    supersedes: field.id, recoveryId: id,
  }
  const revised = { ...payload, manifestHash: seasonContractHash(payload) }
  readSeasonStageManifest(revised)
  const freezeId = seasonResourceId(id, 'replacement-field')
  await tx.tournamentAuditLog.create({ data: {
    id: freezeId, tournamentId, roundNumber: stage, actorType: 'system',
    action: stage === 1 ? 'season_opening_field_frozen' : 'season_stage_field_frozen',
    targetType: stage === 1 ? 'tournament' : 'round', targetId: stage === 1 ? tournamentId : String(stage),
    data: toPrismaJsonInput(revised), createdAt: now,
  } })
  await tx.tournamentParticipant.update({ where: { id: data.entrantId }, data: { status: 'withdrawn' } })
  await tx.tournamentParticipant.update({ where: { id: replacement.id }, data: { status: 'registered' } })
  if (stage > 1) {
    await tx.tournamentLeagueParticipant.updateMany({
      where: { participantId: data.entrantId, league: { tournamentId, round: { roundNumber: stage - 1 } } }, data: { advancementStatus: 'withdrawn' },
    })
    await tx.tournamentLeagueParticipant.updateMany({
      where: { participantId: replacement.id, league: { tournamentId, round: { roundNumber: stage - 1 } } }, data: { advancementStatus: 'advanced' },
    })
  }
  return { freezeId, replacementId: replacement.id }
}

async function reopenSeasonField(tx: Prisma.TransactionClient, tournamentId: string, caseId: string, data: Extract<StoredCase, { kind: 'withdrawal' }>, userId: string, now: Date) {
  const field = await loadSeasonStage(tournamentId, 1, tx)
  if (!field || data.stage !== 1 || data.fieldId !== field.id) throw conflict('The frozen opening field changed.')
  const { impact } = await analyzeWithdrawal(tx, tournamentId, 1, field, data.entrantId, now)
  if (!impact.canReopen) throw conflict('Registration can reopen only before the opening draft and when the seat has no eligible replacement.')
  await tx.tournamentParticipant.update({ where: { id: data.entrantId }, data: { status: 'withdrawn' } })
  const count = await tx.tournamentParticipant.count({ where: { tournamentId, status: 'registered' } })
  await tx.tournamentShell.update({ where: { id: tournamentId }, data: { currentParticipantCount: count, currentRoundNumber: 0 } })
  const control = await tx.tournamentAuditLog.findFirst({
    where: { tournamentId, action: { in: ['season_registration_opened', 'season_registration_paused'] } }, orderBy: newestSeasonEvent,
  })
  if (control) await tx.tournamentAuditLog.create({ data: {
    id: seasonResourceId(caseId, 'pause-invite'), tournamentId, actorType: 'user', actorId: userId, action: 'season_registration_paused',
    targetType: 'tournament', targetId: tournamentId, createdAt: now, data: toPrismaJsonInput({ ...(control.data as object), state: 'paused' }),
  } })
  await tx.tournamentAuditLog.create({ data: {
    id: seasonResourceId(caseId, 'reopen'), tournamentId, actorType: 'user', actorId: userId, action: OPENING_FIELD_REOPENED,
    targetType: 'tournament', targetId: tournamentId, createdAt: now, data: { priorFieldId: field.id, caseId, shortfall: field.manifest.config.participants - count },
  } })
}

export async function resolveSeasonRecovery(userId: string, tournamentId: string, caseId: string, outcome: 'apply' | 'retain' | 'reopen', reason: string, now = new Date()) {
  reason = recoveryReason.parse(reason)
  return prisma.$transaction(async tx => {
    const shell = await ownerShell(tx, tournamentId, userId)
    const event = await tx.tournamentAuditLog.findFirst({ where: { id: caseId, tournamentId, action: RECOVERY_REQUESTED } })
    if (!event) throw hidden()
    const id = seasonResourceId(caseId, 'resolution')
    const existing = await tx.tournamentAuditLog.findUnique({ where: { id } })
    if (existing) {
      if ((existing.data as { outcome?: string } | null)?.outcome !== outcome) throw conflict('The recovery case already has a different resolution.')
      return { caseId, outcome, reused: true }
    }
    const data = event.data as StoredCase
    const currentStage = Math.max(1, shell.currentRoundNumber)
    const effectiveAt = new Date(Math.max(now.getTime(), event.createdAt.getTime() + 1))
    let applied: { freezeId: string; replacementId: string } | undefined
    if (outcome === 'reopen') {
      if (shell.status !== 'rules_published' || currentStage !== 1 || data.kind !== 'withdrawal') throw conflict('This case cannot reopen registration.')
      await reopenSeasonField(tx, tournamentId, caseId, data, userId, effectiveAt)
    }
    if (outcome === 'apply') {
      if (shell.status !== 'rules_published') throw conflict('The tournament is no longer active.')
      if (data.kind === 'withdrawal') applied = await applyWithdrawal(tx, tournamentId, caseId, data, currentStage, effectiveAt)
      else {
        const analysis = await analyzeSeasonScoreCorrection(tx, tournamentId, currentStage, shell.status, data.input, effectiveAt)
        if ((analysis.snapshot.revision ?? 1) !== data.revision || analysis.match.homeScore !== data.before[0] || analysis.match.awayScore !== data.before[1]) {
          throw conflict('The score changed since this proposal. Review the latest score.')
        }
        await applySeasonScoreCorrection(tx, tournamentId, caseId, data.input, analysis, effectiveAt)
      }
    }
    await tx.tournamentAuditLog.create({ data: {
      id, tournamentId, roundNumber: data.stage, actorType: 'user', actorId: userId, action: RECOVERY_RESOLVED,
      targetType: 'recovery', targetId: caseId, createdAt: effectiveAt, data: { outcome, reason, ...(applied ?? {}) },
    } })
    return { caseId, outcome, reused: false, ...(applied ?? {}) }
  }, { timeout: 30_000 })
}

export async function loadSeasonRecovery(userId: string, tournamentId: string, stage?: number, period?: number) {
  const shell = await prisma.tournamentShell.findFirst({
    where: { id: tournamentId, auditLogs: { some: { action: 'season_rules_published' } } },
    select: { currentRoundNumber: true, status: true, commissionerId: true },
  })
  if (!shell || !await canReviewRecovery(prisma, tournamentId, userId, shell.commissionerId)) throw hidden()
  const [open, records] = await Promise.all([
    findOpenSeasonRecoveries(prisma, tournamentId),
    prisma.tournamentAuditLog.findMany({
      where: { tournamentId, action: { in: [SCORE_DELAYED, SCORE_RECOVERED, RECOVERY_REQUESTED, RECOVERY_RESOLVED] } },
      select: { id: true, action: true, targetId: true, data: true, createdAt: true }, orderBy: newestSeasonEvent,
    }),
  ])
  const requests = new Map(records.filter(row => row.action === RECOVERY_REQUESTED).map(row => [row.id, row.data as StoredCase]))
  const recovered = new Set(records.filter(row => row.action === SCORE_RECOVERED).map(row => row.targetId))
  const delays = records.filter(row => row.action === SCORE_DELAYED && !recovered.has(row.id))
  const leagues = await prisma.tournamentLeague.findMany({
    where: { tournamentId, OR: [
      { leagueId: { in: delays.flatMap(row => row.targetId ? [row.targetId] : []) } },
      ...(stage ? [{ round: { roundNumber: stage } }] : []),
    ] }, select: { leagueId: true, name: true },
  })
  const leagueById = new Map(leagues.map(league => [league.leagueId, league.name]))
  let matchups: RecoveryMatch[] = []
  if (stage && period) {
    const stageLeagues = await prisma.tournamentLeague.findMany({
      where: { tournamentId, round: { roundNumber: stage } }, select: { leagueId: true },
    })
    const scores = await prisma.redraftMatchup.findMany({
      where: { seasonId: { in: stageLeagues.flatMap(league => league.leagueId ? [seasonScoringId(league.leagueId)] : []) }, week: period, status: 'final', isMedianMatchup: false },
      select: { id: true, leagueId: true, homeScore: true, awayScore: true, homeRoster: { select: { ownerName: true } }, awayRoster: { select: { ownerName: true } } },
      orderBy: { id: 'asc' },
    })
    matchups = scores.map(row => ({ id: row.id, leagueName: leagueById.get(row.leagueId) ?? 'League', home: row.homeRoster.ownerName,
      away: row.awayRoster?.ownerName ?? null, homeScore: row.homeScore, awayScore: row.awayScore }))
  }
  const field = shell.status === 'rules_published' ? await loadSeasonStage(tournamentId, Math.max(1, shell.currentRoundNumber)) : null
  const entrants = field?.manifest.leagues.flatMap(pool => pool.members.map(member => ({ id: member.id, name: member.displayName }))) ?? []
  return {
    entrants,
    cases: open.map(row => {
      const data = row.data as StoredCase
      const { kind, stage, impact, reason, ownerId } = data
      const view = { id: row.id, openedAt: row.createdAt.toISOString(), stage, impact, reason, ownerId }
      return (kind === 'withdrawal' ? { ...view, kind, manager: data.manager, replacement: data.replacement }
        : { ...view, kind, matchupId: data.matchupId, period: data.period, home: data.home, away: data.away, before: data.before, after: data.after }) satisfies RecoveryCase
    }),
    delays: delays.map(row => ({ id: row.id, leagueName: leagueById.get(row.targetId) ?? 'League', openedAt: row.createdAt.toISOString(),
      ...(row.data as { period: number; stage: number; ownerId: string; escalationAt: string }) })),
    resolutions: records.filter(row => row.action === RECOVERY_RESOLVED).map(row => {
      const request = row.targetId ? requests.get(row.targetId) : undefined
      const summary = request?.kind === 'withdrawal' ? 'Withdrawal · ' + request.manager
        : request?.kind === 'correction' ? 'Score correction · ' + request.home + ' · ' + request.before.join('–') + ' → ' + request.after.join('–') : null
      return { id: row.id, caseId: row.targetId, resolvedAt: row.createdAt.toISOString(), summary, requestReason: request?.reason,
        ...(row.data as { outcome: 'apply' | 'retain' | 'reopen'; reason: string }) }
    }),
    currentStage: Math.max(1, shell.currentRoundNumber), status: shell.status, matchups,
  }
}

export type SeasonRecoveryDashboard = Awaited<ReturnType<typeof loadSeasonRecovery>>
