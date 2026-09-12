/**
 * `TradeExecutionSnapshot` for the GENERIC (`AfLeagueTrade`) path.
 *
 * The native redraft path got its writer first (`lib/redraft/tradeExecutionSnapshot.ts`); the
 * generic path was left explicitly uncovered, with its `genericTradeId` column and relation sitting
 * unused. This closes that half.
 *
 * 🛑 WHY IT IS A SEPARATE MODULE RATHER THAN A PARAMETER. The two paths do not share a state shape.
 * Native redraft state is ROWS — `RedraftRosterPlayer`, one per player, with `droppedAt` deciding
 * membership. Generic state is a JSON BLOB on `Roster.playerData` plus an integer `faabRemaining`.
 * A single "capture roster state" helper covering both would have to branch on every line, and the
 * merged version would be harder to read than the two honest ones.
 *
 * Everything here runs on the caller's transaction, for the reason the model's own doc comment
 * gives: "created atomically with a completed trade and its outbox event". `eventId` is NOT NULL
 * and unique, so the event is emitted with `emitInTx` rather than best-effort afterwards.
 */

import type { Prisma } from '@prisma/client'

import { EVENT, getPlatformEvents } from '@/lib/events'

/**
 * What a generic roster looked like at a point in time.
 *
 * ⚠ `playerData` IS COPIED WHOLE AND DELIBERATELY NOT NORMALISED. It is the column the trade
 * processor reads and writes, so it is the thing a reversal has to restore. Reshaping it here
 * would make the evidence disagree with the writer, which is the one property it cannot afford.
 */
export type GenericRosterStateSnapshot = {
  rosterId: string
  platformUserId: string
  faabRemaining: number | null
  playerData: unknown
}

export type GenericTradeExecutionActorRole = 'user' | 'commissioner' | 'scheduled_processor'

/**
 * Which governance path executed this trade, from the status the finalizer READ.
 *
 * ⚠ `awaiting_votes` maps to `commissioner`, and that is not sloppiness. `finalizeAfLeagueTradeProcessing`
 * requires an elevated commissioner to finalize after the veto window, so a commissioner IS the
 * executing actor; the fact that a league vote preceded it belongs in `governance`, where the vote
 * counts and review type are recorded, rather than in a role that would misname who acted.
 *
 * `scheduled` means the automated sweep executed it. The actor ID in that case is still the human
 * whose action scheduled the trade, so the role is what distinguishes "a person pressed process"
 * from "a cron reached the due time" — two different facts that must not collapse into one.
 */
export function genericTradeActorRole(statusWhenFinalized: string): GenericTradeExecutionActorRole {
  if (statusWhenFinalized === 'awaiting_commissioner' || statusWhenFinalized === 'awaiting_votes') {
    return 'commissioner'
  }
  if (statusWhenFinalized === 'scheduled') return 'scheduled_processor'
  return 'user'
}

/** Both rosters as they stand right now, ordered by id so two captures are comparable. */
export async function captureGenericRosterState(
  tx: Prisma.TransactionClient,
  rosterIds: string[],
): Promise<GenericRosterStateSnapshot[]> {
  const ids = [...new Set(rosterIds.filter(Boolean))].sort()
  const out: GenericRosterStateSnapshot[] = []

  for (const rosterId of ids) {
    const roster = await tx.roster.findUnique({
      where: { id: rosterId },
      select: { id: true, platformUserId: true, faabRemaining: true, playerData: true },
    })
    if (!roster) continue
    out.push({
      rosterId: roster.id,
      platformUserId: roster.platformUserId,
      faabRemaining: roster.faabRemaining,
      playerData: roster.playerData,
    })
  }

  return out
}

export type GenericTradeSnapshotInput = {
  tradeId: string
  leagueId: string
  proposerRosterId: string
  receiverRosterId: string
  executedByActorId: string
  executedByActorRole: GenericTradeExecutionActorRole
  governance: Record<string, unknown>
  validations: Record<string, unknown>
  assetSummary: Record<string, unknown>
  beforeState: GenericRosterStateSnapshot[]
  afterState: GenericRosterStateSnapshot[]
  executedAt: Date
}

export type GenericTradeSnapshotResult = { snapshotId: string; eventId: string }

export async function writeGenericTradeExecutionSnapshot(
  tx: Prisma.TransactionClient,
  input: GenericTradeSnapshotInput,
): Promise<GenericTradeSnapshotResult> {
  const event = await getPlatformEvents().emitInTx(tx, EVENT.TRADE_PROCESSED, {
    leagueId: input.leagueId,
    // ⚠ NULL, NOT AN INVENTED VALUE. `AfLeagueTrade` is the league-agnostic engine; stamping it
    // 'redraft' to fill the field would make the event lie about which stack ran the trade.
    leagueConcept: null,
    actor: { type: 'user' as const, id: input.executedByActorId ?? null },
    source: 'lib:league-trade-engine',
    subjects: [{ kind: 'trade', id: input.tradeId }],
    idempotencyKey: `af-trade.processed:${input.tradeId}`,
    payload: { tradeId: input.tradeId },
  })

  const snapshot = await tx.tradeExecutionSnapshot.create({
    data: {
      tradeId: input.tradeId,
      tradeSource: 'af_league_generic',
      // ⚠ `genericTradeId`, never `nativeTradeId`. Both are unique, nullable FKs to DIFFERENT
      // tables; filling the wrong one points the reversal path at a redraft proposal that does
      // not exist, and the FK would not complain because it is nullable.
      genericTradeId: input.tradeId,
      leagueId: input.leagueId,
      // `AfLeagueTrade` carries no seasonId, and `TradeExecutionSnapshot.seasonId` is a nullable FK
      // to `RedraftSeason` — a table this path has nothing to do with.
      seasonId: null,
      executionIdempotencyKey: `af-league-trade-execution:${input.tradeId}`,
      eventId: event.eventId,
      executedAt: input.executedAt,
      executedByActorId: input.executedByActorId,
      executedByActorRole: input.executedByActorRole,
      governance: input.governance as Prisma.InputJsonValue,
      validations: input.validations as Prisma.InputJsonValue,
      beforeState: { rosters: input.beforeState } as unknown as Prisma.InputJsonValue,
      afterState: { rosters: input.afterState } as unknown as Prisma.InputJsonValue,
      assetSummary: input.assetSummary as Prisma.InputJsonValue,
      // No IDP cap ledger on this path — the generic processor moves `playerData` and FAAB only.
      dependencies: { sourceTransactionIds: [] } as unknown as Prisma.InputJsonValue,
      completeness: 'complete',
    },
    select: { id: true },
  })

  return { snapshotId: snapshot.id, eventId: event.eventId }
}
