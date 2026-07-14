import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { EVENT, getPlatformEvents } from '@/lib/events'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { evaluateTradeReversalReadiness, type ReversalEvidenceSnapshot, type TradeReversalBlocker } from './tradeReversalReadiness'

type JsonRecord = Record<string, unknown>
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const rows = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : []

export type ReverseTradeInput = { tradeId: string; leagueId: string; actorId: string; actorRole: 'commissioner' | 'administrator'; reason: string; idempotencyKey: string; organizationId?: string | null }

async function persistBlocked(tx: Prisma.TransactionClient, input: ReverseTradeInput, snapshotId: string | null, blockers: TradeReversalBlocker[]) {
  const key = `trade-reversal-blocked:${input.tradeId}:${input.idempotencyKey}`
  const existing = await tx.domainEvent.findUnique({ where: { idempotencyKey: key } })
  if (existing) return { reversed: false as const, blocked: true as const, blockers, eventId: existing.eventId }
  const event = await getPlatformEvents().emitInTx(tx, EVENT.TRADE_REVERSAL_BLOCKED, { leagueId: input.leagueId, actor: { type: input.actorRole, id: input.actorId }, idempotencyKey: key, source: 'trade_reversal', subjects: [{ kind: 'trade', id: input.tradeId }], payload: { tradeId: input.tradeId, snapshotId: snapshotId ?? undefined, blockerCodes: blockers.map((row) => row.code) } })
  await tx.leagueAuditLog.create({ data: { leagueId: input.leagueId, userId: input.actorId, actionType: 'trade_reversal_blocked', entityType: 'trade', entityId: input.tradeId, metadata: { snapshotId, blockers, eventId: event.eventId, idempotencyKey: input.idempotencyKey } } })
  await tx.leagueEvent.create({ data: { leagueId: input.leagueId, eventType: 'trade_reversal_blocked', title: 'Trade reversal blocked', description: 'The requested reversal could not be completed. Review the commissioner audit for details.', visibility: 'commissioner', payload: { tradeId: input.tradeId, snapshotId, eventId: event.eventId, idempotencyKey: input.idempotencyKey } } })
  return { reversed: false as const, blocked: true as const, blockers, eventId: event.eventId }
}

export async function reverseTradeFromExecutionSnapshot(input: ReverseTradeInput) {
  if (!input.reason.trim()) throw new Error('Reversal reason is required')
  if (!(await isElevatedCommissioner(input.leagueId, input.actorId))) throw new Error('Commissioner authorization required')
  const existing = await prisma.tradeReversal.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
  if (existing) return { reversed: true as const, blocked: false as const, reversal: existing, idempotent: true }

  return prisma.$transaction(async (tx) => {
    const snapshot = await tx.tradeExecutionSnapshot.findUnique({ where: { tradeId: input.tradeId } })
    if (!snapshot || snapshot.leagueId !== input.leagueId || (input.organizationId && snapshot.organizationId !== input.organizationId)) {
      return persistBlocked(tx, input, snapshot?.id ?? null, [{ code: 'MISSING_EXECUTION_SNAPSHOT', message: 'Matching immutable execution evidence is unavailable.' }])
    }
    const prior = await tx.tradeReversal.findFirst({ where: { OR: [{ tradeId: input.tradeId }, { idempotencyKey: input.idempotencyKey }] } })
    if (prior) return { reversed: true as const, blocked: false as const, reversal: prior, idempotent: true }
    const assetSummary = record(snapshot.assetSummary)
    if (rows(assetSummary.draftAssetIds).filter(Boolean).length) return persistBlocked(tx, input, snapshot.id, [{ code: 'DRAFT_ASSET_ALREADY_MOVED', message: 'Draft asset restoration is not supported by the current ownership model.' }])
    if (rows(assetSummary.idpSalaryTransfers).length) return persistBlocked(tx, input, snapshot.id, [{ code: 'IDP_CAP_DEPENDENCY', message: 'IDP cap ledger reversal requires additional immutable ledger evidence.' }])

    const before = record(snapshot.beforeState)
    const after = record(snapshot.afterState)
    let readinessBlockers: TradeReversalBlocker[] = []
    if (snapshot.tradeSource === 'native_redraft') {
      const currentPlayers = await tx.redraftRosterPlayer.findMany({ where: { rosterId: { in: rows<{ id: string }>(after.rosters).map((row) => row.id) }, droppedAt: null }, select: { playerId: true, rosterId: true, droppedAt: true } })
      const currentRosters = await tx.redraftRoster.findMany({ where: { id: { in: rows<{ id: string }>(after.rosters).map((row) => row.id) } }, select: { id: true, faabBalance: true } })
      const currentSalaries = await tx.iDPSalaryRecord.findMany({ where: { id: { in: rows<{ id: string }>(after.idpSalaries).map((row) => row.id) } }, select: { id: true, playerId: true, rosterId: true } })
      const readiness = evaluateTradeReversalReadiness({ snapshot: { id: snapshot.id, completeness: snapshot.completeness, seasonId: snapshot.seasonId, beforeState: before, afterState: after } as ReversalEvidenceSnapshot, currentSeasonId: snapshot.seasonId ?? '', currentPlayers, currentRosters, currentIdpSalaries: currentSalaries })
      readinessBlockers = readiness.blockers
    } else {
      const expected = rows<{ id: string; playerData: unknown; faabRemaining: number | null }>(after.rosters)
      const current = await tx.roster.findMany({ where: { id: { in: expected.map((row) => row.id) }, leagueId: input.leagueId }, select: { id: true, playerData: true, faabRemaining: true } })
      const currentById = new Map(current.map((row) => [row.id, row]))
      const genericStateChanged = expected.some((expectedRoster) => {
        const currentRoster = currentById.get(expectedRoster.id)
        return !currentRoster
          || currentRoster.faabRemaining !== expectedRoster.faabRemaining
          || JSON.stringify(currentRoster.playerData) !== JSON.stringify(expectedRoster.playerData)
      })
      if (genericStateChanged) readinessBlockers.push({ code: 'DEPENDENT_TRANSACTION_EXISTS', message: 'Generic roster state changed after trade execution.' })
      if (snapshot.completeness !== 'complete') readinessBlockers.push({ code: 'SNAPSHOT_INCOMPLETE', message: 'Execution evidence is incomplete.' })
    }
    if (readinessBlockers.length) return persistBlocked(tx, input, snapshot.id, readinessBlockers)

    if (snapshot.tradeSource === 'native_redraft') {
      for (const player of rows<{ id: string; rosterId: string; slotType: string; acquisitionType: string; addedAt: string | Date; isLocked: boolean }>(before.players)) await tx.redraftRosterPlayer.update({ where: { id: player.id }, data: { rosterId: player.rosterId, slotType: player.slotType, acquisitionType: player.acquisitionType, addedAt: new Date(player.addedAt), isLocked: player.isLocked, droppedAt: null } })
      for (const roster of rows<{ id: string; faabBalance: number | null }>(before.rosters)) await tx.redraftRoster.update({ where: { id: roster.id }, data: { faabBalance: roster.faabBalance ?? 0 } })
      const claimed = await tx.redraftTradeProposal.updateMany({ where: { id: input.tradeId, status: 'accepted' }, data: { status: 'reversed' } })
      if (claimed.count !== 1) throw new Error('Trade is not in an executed reversible state')
    } else {
      for (const roster of rows<{ id: string; playerData: Prisma.InputJsonValue; faabRemaining: number | null }>(before.rosters)) await tx.roster.update({ where: { id: roster.id }, data: { playerData: roster.playerData, faabRemaining: roster.faabRemaining } })
      const claimed = await tx.afLeagueTrade.updateMany({ where: { id: input.tradeId, status: 'processed' }, data: { status: 'reversed' } })
      if (claimed.count !== 1) throw new Error('Trade is not in an executed reversible state')
    }

    const reversalId = crypto.randomUUID()
    const noticeKey = `trade-reversed:${input.tradeId}`
    const reversedAt = new Date()
    const event = await getPlatformEvents().emitInTx(tx, EVENT.TRADE_REVERSED, { leagueId: input.leagueId, seasonId: snapshot.seasonId, actor: { type: input.actorRole, id: input.actorId }, idempotencyKey: `trade-reverse:${input.tradeId}`, source: 'trade_reversal', subjects: [{ kind: 'trade', id: input.tradeId }, { kind: 'trade_reversal', id: reversalId }], payload: { tradeId: input.tradeId, snapshotId: snapshot.id, reversalId } })
    const reversal = await tx.tradeReversal.create({ data: { id: reversalId, tradeId: input.tradeId, snapshotId: snapshot.id, leagueId: input.leagueId, seasonId: snapshot.seasonId, actorId: input.actorId, actorRole: input.actorRole, reason: input.reason.trim(), idempotencyKey: input.idempotencyKey, readiness: { reversible: true, blockers: [] }, restoredState: before as Prisma.InputJsonValue, eventId: event.eventId, noticeKey, reversedAt } })
    await tx.leagueAuditLog.create({ data: { leagueId: input.leagueId, userId: input.actorId, actionType: 'trade_reversed', entityType: 'trade_reversal', entityId: reversal.id, beforeState: after as Prisma.InputJsonValue, afterState: before as Prisma.InputJsonValue, metadata: { tradeId: input.tradeId, snapshotId: snapshot.id, eventId: event.eventId, reason: input.reason, idempotencyKey: input.idempotencyKey } } })
    await tx.leagueEvent.create({ data: { leagueId: input.leagueId, eventType: 'trade_reversed', title: 'Completed trade reversed', description: 'A completed trade was reversed by the commissioner. The reason is available in league audit history.', visibility: 'league', payload: { tradeId: input.tradeId, reversalId, snapshotId: snapshot.id, eventId: event.eventId, noticeKey } } })
    return { reversed: true as const, blocked: false as const, reversal, idempotent: false }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
