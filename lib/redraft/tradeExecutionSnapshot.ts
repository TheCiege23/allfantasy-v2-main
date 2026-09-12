/**
 * `TradeExecutionSnapshot` — the before/after evidence for a settled native redraft trade.
 *
 * 🛑 THE TABLE EXISTED WITH NO WRITER. Measured on `origin/main`: `TradeExecutionSnapshot` is
 * referenced in exactly two places in production code — a tenant-scope table list and a
 * commissioner policy-coverage test — and `tradeExecutionSnapshot.create` appears NOWHERE. The
 * model, its `TradeReversal` counterpart, and several documents describing both were all on main;
 * the rows were not. Nothing could be reversed, because nothing recorded what to reverse to.
 *
 * ⚠ EVERYTHING HERE RUNS ON THE CALLER'S TRANSACTION, AND THAT IS THE POINT. The model's own doc
 * comment says "created atomically with a completed trade and its outbox event". Evidence written
 * after the fact can disagree with the trade it describes; evidence written inside the settlement
 * either commits with it or does not exist. `eventId` is NOT NULL and unique, so the event is
 * emitted with `emitInTx` on the same transaction rather than best-effort afterwards.
 *
 * The cost of that choice, stated rather than hidden: an outbox write failure now rolls the trade
 * back, where the previous post-commit emit would have swallowed it. The outbox lives in the same
 * database as the settlement, so this adds essentially no new failure mode — a database that
 * cannot take the event could not have taken the roster moves either.
 *
 * ⚠ `beforeState` MUST BE READ BEFORE ANYTHING MOVES. Inside one transaction the reads see the
 * pre-mutation rows only until the settlement writes them; capture at the top, after the claim.
 */

import type { Prisma } from '@prisma/client'

import { EVENT, getPlatformEvents } from '@/lib/events'

export type RedraftRosterStateSnapshot = {
  rosterId: string
  teamName: string | null
  ownerId: string
  faabBalance: number | null
  players: {
    playerId: string
    playerName: string
    position: string
    slotType: string
    acquisitionType: string
  }[]
}

/**
 * Both rosters as they stand right now, ordered deterministically.
 *
 * ⚠ ORDERING IS NOT COSMETIC HERE. A reversal compares a snapshot against live state, and two
 * JSON blobs that differ only in row order read as a difference. Sorting by `playerId` makes the
 * evidence comparable.
 */
export async function captureRedraftRosterState(
  tx: Prisma.TransactionClient,
  rosterIds: string[],
): Promise<RedraftRosterStateSnapshot[]> {
  const ids = [...new Set(rosterIds.filter(Boolean))].sort()
  const out: RedraftRosterStateSnapshot[] = []

  for (const rosterId of ids) {
    const roster = await tx.redraftRoster.findUnique({
      where: { id: rosterId },
      select: { id: true, teamName: true, ownerId: true, faabBalance: true },
    })
    if (!roster) continue

    const players = await tx.redraftRosterPlayer.findMany({
      // `droppedAt: null` is what "on the roster" means here — a dropped row stays for history.
      where: { rosterId, droppedAt: null },
      select: {
        playerId: true,
        playerName: true,
        position: true,
        slotType: true,
        acquisitionType: true,
      },
      orderBy: { playerId: 'asc' },
    })

    out.push({
      rosterId: roster.id,
      teamName: roster.teamName,
      ownerId: roster.ownerId,
      faabBalance: roster.faabBalance,
      players,
    })
  }

  return out
}

export type RedraftTradeSnapshotInput = {
  proposalId: string
  leagueId: string
  seasonId: string | null
  proposerRosterId: string
  receiverRosterId: string
  executedByActorId: string
  /** `commissioner` when a commissioner forced it through, `league_vote` after a vote, else `user`. */
  executedByActorRole: 'user' | 'commissioner' | 'league_vote'
  governance: Record<string, unknown>
  validations: Record<string, unknown>
  assetSummary: Record<string, unknown>
  /** `IDPCapTransaction` ids created in this same transaction, for reversal preflight. */
  sourceTransactionIds: string[]
  beforeState: RedraftRosterStateSnapshot[]
  afterState: RedraftRosterStateSnapshot[]
  executedAt: Date
}

export type RedraftTradeSnapshotResult = { snapshotId: string; eventId: string }

/**
 * Emit the settlement's outbox event and write the snapshot that points at it — both on `tx`.
 *
 * The idempotency key is derived from the proposal, so a retry of the same settlement cannot
 * produce a second snapshot: `tradeId` and `executionIdempotencyKey` are both unique columns and
 * a duplicate attempt fails the transaction rather than silently forking the evidence.
 */
export async function writeRedraftTradeExecutionSnapshot(
  tx: Prisma.TransactionClient,
  input: RedraftTradeSnapshotInput,
): Promise<RedraftTradeSnapshotResult> {
  const event = await getPlatformEvents().emitInTx(tx, EVENT.TRADE_PROCESSED, {
    leagueId: input.leagueId,
    seasonId: input.seasonId ?? undefined,
    leagueConcept: 'redraft' as const,
    actor: { type: 'user' as const, id: input.executedByActorId ?? null },
    source: 'route:trade-votes',
    subjects: [{ kind: 'trade', id: input.proposalId }],
    // Same deterministic key the post-commit emit used, so moving it in here does not double-emit.
    idempotencyKey: `trade.processed:${input.proposalId}`,
    payload: { tradeId: input.proposalId },
  })

  const snapshot = await tx.tradeExecutionSnapshot.create({
    data: {
      tradeId: input.proposalId,
      tradeSource: 'redraft_native',
      nativeTradeId: input.proposalId,
      leagueId: input.leagueId,
      seasonId: input.seasonId,
      executionIdempotencyKey: `redraft-trade-execution:${input.proposalId}`,
      eventId: event.eventId,
      executedAt: input.executedAt,
      executedByActorId: input.executedByActorId,
      executedByActorRole: input.executedByActorRole,
      governance: input.governance as Prisma.InputJsonValue,
      validations: input.validations as Prisma.InputJsonValue,
      beforeState: { rosters: input.beforeState } as unknown as Prisma.InputJsonValue,
      afterState: { rosters: input.afterState } as unknown as Prisma.InputJsonValue,
      assetSummary: input.assetSummary as Prisma.InputJsonValue,
      dependencies: {
        sourceTransactionIds: input.sourceTransactionIds,
      } as unknown as Prisma.InputJsonValue,
      // `complete` is the default; it is set explicitly so a future partial-capture path has to
      // choose a value rather than inherit one.
      completeness: 'complete',
    },
    select: { id: true },
  })

  return { snapshotId: snapshot.id, eventId: event.eventId }
}
