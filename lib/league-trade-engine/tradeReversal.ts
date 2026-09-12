/**
 * Reversing an executed generic (`AfLeagueTrade`) trade from its execution snapshot.
 *
 * 🛑 `TradeReversal` HAD NO WRITER AND NO PREFLIGHT — the model existed, the FK to
 * `TradeExecutionSnapshot` existed, `onDelete: Restrict` protected a snapshot no reversal could
 * ever reference, and not one line of code created a row. Writing the snapshots (#748, #751) was
 * the prerequisite; this is the part that makes them pay for themselves.
 *
 * ⚠ THIS IS THE MOST DESTRUCTIVE OPERATION IN THE TRADE STACK. It overwrites two rosters with
 * recorded state. Everything here is built so that it refuses far more readily than it acts:
 *
 *   - it restores ONLY from a snapshot this codebase wrote, never from reconstructed state
 *   - it refuses unless the rosters still look exactly as the trade LEFT them
 *   - the readiness verdict is recomputed INSIDE the transaction, not trusted from the preflight
 *   - it is idempotent by unique key, so a double-click cannot reverse twice
 *
 * ⚠ GENERIC PATH ONLY. Native redraft trades (`RedraftTradeProposal`) also write snapshots now, but
 * their state is ROWS — `RedraftRosterPlayer`, with `droppedAt` deciding membership and an IDP cap
 * ledger alongside. Restoring rows is a different and harder problem than overwriting a JSON blob,
 * and pretending one function does both is how a reversal half-applies. That path is untouched and
 * `reverseGenericTrade` refuses anything whose snapshot is not `af_league_generic`.
 */

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { EVENT, getPlatformEvents } from '@/lib/events'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import type { GenericRosterStateSnapshot } from '@/lib/league-trade-engine/tradeExecutionSnapshot'

export type ReversalBlocker =
  | 'TRADE_NOT_FOUND'
  | 'TRADE_NOT_PROCESSED'
  | 'NO_EXECUTION_SNAPSHOT'
  | 'SNAPSHOT_NOT_GENERIC'
  | 'ALREADY_REVERSED'
  | 'ROSTER_MISSING'
  | 'ROSTER_CHANGED_SINCE_EXECUTION'

export type ReversalReadiness = {
  ok: boolean
  blockers: ReversalBlocker[]
  /** Per-roster comparison, kept in the row so a refusal can be explained after the fact. */
  drift: { rosterId: string; expected: string; actual: string }[]
}

/**
 * A roster reduced to the two things a reversal actually depends on: WHO is on it and how much
 * FAAB it holds.
 *
 * ⚠ DELIBERATELY NOT A WHOLE-BLOB COMPARISON. `playerData` carries lineup slots, timestamps and
 * provider scratch that legitimately change without anyone trading — comparing it byte for byte
 * would refuse almost every real reversal, and a guard that always refuses gets switched off. The
 * sorted player-id set plus FAAB is what a trade moves, so it is what has to be unchanged.
 */
function rosterFingerprint(playerData: unknown, faabRemaining: number | null): string {
  const ids = [...getRosterPlayerIds(playerData)].sort()
  return JSON.stringify({ ids, faab: faabRemaining ?? 0 })
}

function snapshotFingerprint(state: GenericRosterStateSnapshot): string {
  return rosterFingerprint(state.playerData, state.faabRemaining)
}

type SnapshotRosters = { rosters: GenericRosterStateSnapshot[] }

function readRosters(value: unknown): GenericRosterStateSnapshot[] {
  const v = value as SnapshotRosters | null
  return Array.isArray(v?.rosters) ? v.rosters : []
}

/**
 * Can this trade be reversed right now, and if not, exactly why.
 *
 * Runs on a transaction client when given one so the settlement path can re-check under the same
 * lock it writes with; falls back to `prisma` for a read-only preflight.
 */
export async function evaluateGenericTradeReversalReadiness(
  db: Prisma.TransactionClient | typeof prisma,
  tradeId: string,
): Promise<ReversalReadiness> {
  const blockers: ReversalBlocker[] = []
  const drift: ReversalReadiness['drift'] = []

  const trade = await db.afLeagueTrade.findUnique({
    where: { id: tradeId },
    select: { id: true, status: true, proposerRosterId: true, receiverRosterId: true },
  })
  if (!trade) return { ok: false, blockers: ['TRADE_NOT_FOUND'], drift }
  if (trade.status !== 'processed') blockers.push('TRADE_NOT_PROCESSED')

  const snapshot = await db.tradeExecutionSnapshot.findUnique({
    where: { tradeId },
    select: { id: true, tradeSource: true, afterState: true },
  })
  if (!snapshot) {
    // The common case for anything executed before the snapshot writers landed. There is no
    // reconstruction path and there should not be one: a guessed "before" is not evidence.
    blockers.push('NO_EXECUTION_SNAPSHOT')
    return { ok: false, blockers, drift }
  }
  if (snapshot.tradeSource !== 'af_league_generic') blockers.push('SNAPSHOT_NOT_GENERIC')

  const existing = await db.tradeReversal.findUnique({ where: { tradeId }, select: { id: true } })
  if (existing) blockers.push('ALREADY_REVERSED')

  // Has anything touched these rosters since the trade left them? A later trade, a waiver claim or
  // a commissioner edit all make the recorded "before" the wrong thing to write back — restoring it
  // would silently undo whatever came after.
  const after = readRosters(snapshot.afterState)
  for (const expected of after) {
    const current = await db.roster.findUnique({
      where: { id: expected.rosterId },
      select: { playerData: true, faabRemaining: true },
    })
    if (!current) {
      blockers.push('ROSTER_MISSING')
      continue
    }
    const actualFp = rosterFingerprint(current.playerData, current.faabRemaining)
    const expectedFp = snapshotFingerprint(expected)
    if (actualFp !== expectedFp) {
      blockers.push('ROSTER_CHANGED_SINCE_EXECUTION')
      drift.push({ rosterId: expected.rosterId, expected: expectedFp, actual: actualFp })
    }
  }

  return { ok: blockers.length === 0, blockers: [...new Set(blockers)], drift }
}

export type ReverseGenericTradeInput = {
  tradeId: string
  actorUserId: string
  actorRole: string
  reason: string
}

export type ReverseGenericTradeResult =
  | { ok: true; reversalId: string; eventId: string; rostersRestored: number }
  | { ok: false; readiness: ReversalReadiness }

export async function reverseGenericTrade(
  input: ReverseGenericTradeInput,
): Promise<ReverseGenericTradeResult> {
  // Cheap refusal before opening a transaction. The verdict is NOT trusted — it is recomputed
  // below inside the transaction, because everything it checked can change in between.
  const preflight = await evaluateGenericTradeReversalReadiness(prisma, input.tradeId)
  if (!preflight.ok) return { ok: false, readiness: preflight }

  try {
    return await prisma.$transaction(async (tx) => {
      // ⚠ RE-EVALUATED UNDER THE TRANSACTION. The preflight above is a courtesy to the caller; this
      // is the one that decides. A reversal authorised by a stale read is exactly the clobber this
      // whole module exists to prevent.
      const readiness = await evaluateGenericTradeReversalReadiness(tx, input.tradeId)
      if (!readiness.ok) throw new ReversalRefused(readiness)

      const trade = await tx.afLeagueTrade.findUniqueOrThrow({
        where: { id: input.tradeId },
        select: { id: true, leagueId: true, status: true },
      })
      const snapshot = await tx.tradeExecutionSnapshot.findUniqueOrThrow({
        where: { tradeId: input.tradeId },
        select: { id: true, beforeState: true },
      })

      const before = readRosters(snapshot.beforeState)
      for (const state of before) {
        await tx.roster.update({
          where: { id: state.rosterId },
          data: {
            playerData: state.playerData as Prisma.InputJsonValue,
            faabRemaining: state.faabRemaining,
          },
        })
      }

      // Claim conditionally, same shape as the settlement path: two reversals racing must not both
      // write, and `status` is what decides.
      const claimed = await tx.afLeagueTrade.updateMany({
        where: { id: trade.id, status: 'processed' },
        data: { status: 'reversed' },
      })
      if (claimed.count === 0) {
        throw new ReversalRefused({ ok: false, blockers: ['ALREADY_REVERSED'], drift: [] })
      }

      const event = await getPlatformEvents().emitInTx(tx, EVENT.TRADE_CANCELED, {
        leagueId: trade.leagueId,
        leagueConcept: null,
        actor: { type: 'user' as const, id: input.actorUserId ?? null },
        source: 'lib:league-trade-engine',
        subjects: [{ kind: 'trade', id: trade.id }],
        idempotencyKey: `af-trade.reversed:${trade.id}`,
        payload: { tradeId: trade.id, reason: input.reason },
      })

      const reversal = await tx.tradeReversal.create({
        data: {
          tradeId: trade.id,
          snapshotId: snapshot.id,
          leagueId: trade.leagueId,
          // `TradeReversal.seasonId` is a nullable FK to `RedraftSeason`, which this path has
          // nothing to do with — the same reason the generic snapshot leaves it null.
          seasonId: null,
          actorId: input.actorUserId,
          actorRole: input.actorRole,
          reason: input.reason,
          idempotencyKey: `af-league-trade-reversal:${trade.id}`,
          readiness: readiness as unknown as Prisma.InputJsonValue,
          restoredState: { rosters: before } as unknown as Prisma.InputJsonValue,
          eventId: event.eventId,
          noticeKey: `af_trade:${trade.id}:reversed`,
          reversedAt: new Date(),
        },
        select: { id: true },
      })

      return {
        ok: true as const,
        reversalId: reversal.id,
        eventId: event.eventId,
        rostersRestored: before.length,
      }
    })
  } catch (e) {
    if (e instanceof ReversalRefused) return { ok: false, readiness: e.readiness }
    throw e
  }
}

/** Carries a readiness verdict out of the transaction as a refusal rather than a crash. */
class ReversalRefused extends Error {
  readonly readiness: ReversalReadiness
  constructor(readiness: ReversalReadiness) {
    super(`Trade reversal refused: ${readiness.blockers.join(', ')}`)
    this.name = 'ReversalRefused'
    this.readiness = readiness
  }
}
