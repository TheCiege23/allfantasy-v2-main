import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { loadPublishedScheduleContract } from './seasonScheduleReview'
import { readSeasonOpeningLockedProviderPairs } from './seasonScoreLedger'
import { appendSeasonOutcomeReceipt, readSeasonOutcomeHistory, type SeasonOutcomeClaim, type SeasonOutcomeScope } from './seasonOutcomeEvidence'

const ACTION = 'season_outcome_evidence_candidate'

async function context(userId: string, tournamentId: string, freezeId: string, leagueKey: string, period: number) {
  const { manifest, calendar } = await loadPublishedScheduleContract(userId, tournamentId, freezeId)
  const pool = manifest.leagues.find(item => item.key === leagueKey)
  if (!pool || !manifest.config.rules?.calendar.periods.some(item => item.number === period)) throw new BlueprintOperationError('Choose a frozen league and published period.', 409)
  const leagueId = seasonResourceId(freezeId, leagueKey)
  const scope: SeasonOutcomeScope = { tournamentId, freezeId, leagueId, period, manifestHash: manifest.manifestHash, rulesHash: manifest.rulesHash }
  const locked = await readSeasonOpeningLockedProviderPairs(leagueId, period, userId)
  const publishedGameIds = new Set(calendar.assignments.filter(item => item.period === period).map(item => item.gameId))
  return { scope, locked, publishedGameIds }
}

function checkSubject(claim: SeasonOutcomeClaim, publishedGameIds: Set<string>, locked: Awaited<ReturnType<typeof readSeasonOpeningLockedProviderPairs>>) {
  const subject = claim.subject
  if (subject.kind === 'player_game') {
    if (!locked.gameBindings.some(binding => publishedGameIds.has(binding.gameId) && binding.providerGameId === subject.providerGameId) ||
      !locked.pairs.some(pair => pair.providerGameId === subject.providerGameId && pair.providerPlayerId === subject.providerPlayerId)) {
      throw new BlueprintOperationError('The player/game claim lacks a verified locked receipt.', 409)
    }
  } else if (subject.kind === 'player_period') {
    if (!locked.draftedWithoutLockedGamePlayerIds.includes(subject.playerId)) throw new BlueprintOperationError('The player is not a drafted player without a locked game.', 409)
  } else if (!publishedGameIds.has(subject.providerGameId) || locked.pairs.some(pair => !pair.providerGameId || pair.providerGameId === subject.providerGameId)) {
    throw new BlueprintOperationError('The game claim needs a published game without a locked player receipt.', 409)
  }
}

function auditId(scope: SeasonOutcomeScope, revision: number) {
  return seasonResourceId(scope.freezeId, `${scope.leagueId}:outcome-evidence:${scope.period}:${revision}`)
}

async function savedHistory(tx: typeof prisma, scope: SeasonOutcomeScope) {
  const rows = await tx.tournamentAuditLog.findMany({ where: { tournamentId: scope.tournamentId, action: ACTION, targetId: `${scope.leagueId}:${scope.period}` }, take: 10001 })
  const history = readSeasonOutcomeHistory(rows.map(row => row.data), scope)
  if (rows.some(row => row.actorType !== 'system' || row.targetType !== 'league_period' || row.id !== auditId(scope, (row.data as { revision?: number } | null)?.revision ?? -1))) throw new BlueprintOperationError('Outcome evidence audit identity differs.', 409)
  return history
}

/** Internal trusted-source intake. Every claim remains unverified until a vendor contract and closure proof exist. */
export async function recordSeasonOutcomeCandidate(userId: string, tournamentId: string, freezeId: string,
  leagueKey: string, period: number, requestId: string, claim: SeasonOutcomeClaim, artifact: Record<string, unknown>) {
  const { scope, locked, publishedGameIds } = await context(userId, tournamentId, freezeId, leagueKey, period)
  checkSubject(claim, publishedGameIds, locked)
  return prisma.$transaction(async tx => {
    const shell = await tx.tournamentShell.findUnique({ where: { id: tournamentId } })
    if (!shell || shell.commissionerId !== userId || shell.status !== 'rules_published') throw new BlueprintOperationError('Tournament access changed during evidence capture.', 409)
    const history = await savedHistory(tx as typeof prisma, scope)
    const { receipt, existing } = appendSeasonOutcomeReceipt(history, scope, requestId, claim, artifact, new Date().toISOString())
    if (!existing) await tx.tournamentAuditLog.create({ data: { id: auditId(scope, receipt.revision), tournamentId,
      action: ACTION, actorType: 'system', actorId: null, targetType: 'league_period', targetId: `${scope.leagueId}:${period}`, data: receipt as unknown as Prisma.InputJsonValue } })
    return { revision: receipt.revision, digest: receipt.digest, existing, contractVerified: false as const, scoringCertified: false as const }
  })
}

/** Read-only owner review; candidate counts never close coverage or infer zero points. */
export async function readSeasonOutcomeCandidates(userId: string, tournamentId: string, freezeId: string, leagueKey: string, period: number) {
  const { scope } = await context(userId, tournamentId, freezeId, leagueKey, period)
  const history = await savedHistory(prisma, scope)
  return { revision: history.length, claims: history, contractVerified: false as const, scoringCertified: false as const }
}
