/**
 * Reversing an executed NATIVE redraft trade (`RedraftTradeProposal`) from its execution snapshot.
 *
 * The generic `AfLeagueTrade` path got its reversal first (`lib/league-trade-engine/tradeReversal.ts`)
 * and explicitly refused native snapshots, because this side is a different and harder problem:
 *
 *   generic  one JSON blob per roster (`Roster.playerData`) — restore by overwriting it
 *   native   ROWS — `RedraftRosterPlayer`, with `droppedAt` deciding membership — plus FAAB on
 *            `RedraftRoster`, plus an APPEND-ONLY IDP cap ledger alongside
 *
 * You cannot "overwrite" rows back into place. Reversal here is the precise inverse of what
 * `settleRedraftTradeAssets` and `applyRedraftTradeCapTransfersInTransaction` did, applied only to
 * what THIS trade moved, and refused whenever the world no longer looks the way the trade left it.
 *
 * ⚠ SAME REFUSAL-FIRST DISCIPLINE AS THE GENERIC PATH, BECAUSE THIS IS EQUALLY DESTRUCTIVE:
 *   - restores only from a snapshot this codebase wrote; no reconstruction path
 *   - refuses unless both rosters' membership and FAAB still match the snapshot's `afterState`
 *   - refuses unless every IDP salary record the trade moved is still where the trade put it
 *   - recomputes readiness INSIDE the transaction; the preflight is only a courtesy
 *   - claims `accepted -> reversed` conditionally, and is idempotent by unique key
 *
 * ⚠ `isLocked` IS NOT RESTORED, AND DOES NOT NEED TO BE — IT IS NOT STORED STATE. The lineup lock is
 * derived from the game schedule at request time by `hydrateRedraftLineupLocks`
 * (`lib/redraft/lineupLock.ts`), which stamps it onto players in memory and never writes the column.
 * Measured 2026-09-12: 62,934 `redraft_roster_players` rows in production, 0 with `isLocked = true`.
 * So there is no lock state for a snapshot to record or for a reversal to put back; a reversed
 * player's lock is recomputed from kickoff on the next read. Restoring a recorded value would be
 * actively wrong for a lock that expires with the scoring period.
 *
 * An earlier version of this header said locked players "come back UNLOCKED" after a reversal, and
 * the reversal dialog repeated it to commissioners. That was never true, because nothing ever set the
 * column to true in the first place.
 *
 * ⚠ THE CAP LEDGER IS NEVER EDITED OR DELETED. `IDPCapTransaction` has no status column and is the
 * history of what happened; the original `trade_out`/`trade_in` rows stay, and the reversal APPENDS
 * `trade_reversal_out`/`trade_reversal_in` rows. A ledger that forgets a trade happened is not a
 * ledger.
 */

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { EVENT, getPlatformEvents } from '@/lib/events'
import {
  captureRedraftRosterState,
  type RedraftRosterStateSnapshot,
} from '@/lib/redraft/tradeExecutionSnapshot'

type Db = Prisma.TransactionClient | typeof prisma

/** Mirrors `ACTIVE_STATUSES` in `lib/idp/capEngine.ts`, which is not exported. */
const ACTIVE_SALARY_STATUSES = ['active', 'franchise_tagged']

export type NativeReversalBlocker =
  | 'PROPOSAL_NOT_FOUND'
  | 'PROPOSAL_NOT_ACCEPTED'
  | 'NO_EXECUTION_SNAPSHOT'
  | 'SNAPSHOT_NOT_NATIVE'
  | 'ALREADY_REVERSED'
  | 'ROSTER_CHANGED_SINCE_EXECUTION'
  | 'CAP_LEDGER_MISSING'
  | 'CAP_RECORD_MOVED_SINCE_EXECUTION'

export type NativeReversalReadiness = {
  ok: boolean
  blockers: NativeReversalBlocker[]
  drift: { rosterId: string; expected: string; actual: string }[]
}

/**
 * Membership + FAAB, not every column. Slot and lineup changes happen without anyone trading; a
 * comparison that included them would refuse nearly every real reversal. Who is on the roster and
 * how much FAAB it holds is exactly what a trade moves, so it is what must be unchanged.
 */
function fingerprint(state: RedraftRosterStateSnapshot): string {
  return JSON.stringify({
    ids: state.players.map((p) => p.playerId).sort(),
    faab: state.faabBalance ?? 0,
  })
}

function readRosters(value: unknown): RedraftRosterStateSnapshot[] {
  const v = value as { rosters?: unknown } | null
  return Array.isArray(v?.rosters) ? (v!.rosters as RedraftRosterStateSnapshot[]) : []
}

function readSourceTransactionIds(dependencies: unknown): string[] {
  const d = dependencies as { sourceTransactionIds?: unknown } | null
  return Array.isArray(d?.sourceTransactionIds)
    ? d!.sourceTransactionIds.filter((x): x is string => typeof x === 'string')
    : []
}

/** One salary record the trade moved: from the `trade_out` roster to the `trade_in` roster. */
type CapMove = { playerId: string; fromRosterId: string; toRosterId: string }

/**
 * Rebuild what the cap transfer did from the ledger rows the snapshot points at.
 *
 * `missing` means the evidence is incomplete — a row count that does not match, or a player with a
 * `trade_out` and no `trade_in`. Reversing on partial evidence is how salary ends up on nobody.
 */
async function readCapMoves(db: Db, ids: string[]): Promise<{ moves: CapMove[]; missing: boolean }> {
  if (ids.length === 0) return { moves: [], missing: false }

  const rows = await db.iDPCapTransaction.findMany({
    where: { id: { in: ids } },
    select: { id: true, playerId: true, rosterId: true, transactionType: true },
  })
  if (rows.length !== ids.length) return { moves: [], missing: true }

  const byPlayer = new Map<string, { out?: string; in?: string }>()
  for (const r of rows) {
    const entry = byPlayer.get(r.playerId) ?? {}
    if (r.transactionType === 'trade_out') entry.out = r.rosterId
    else if (r.transactionType === 'trade_in') entry.in = r.rosterId
    byPlayer.set(r.playerId, entry)
  }

  const moves: CapMove[] = []
  for (const [playerId, entry] of byPlayer) {
    if (!entry.out || !entry.in) return { moves: [], missing: true }
    moves.push({ playerId, fromRosterId: entry.out, toRosterId: entry.in })
  }
  return { moves, missing: false }
}

export async function evaluateNativeTradeReversalReadiness(
  db: Db,
  proposalId: string,
): Promise<NativeReversalReadiness> {
  const blockers: NativeReversalBlocker[] = []
  const drift: NativeReversalReadiness['drift'] = []

  const proposal = await db.redraftTradeProposal.findUnique({
    where: { id: proposalId },
    select: { id: true, status: true, leagueId: true },
  })
  if (!proposal) return { ok: false, blockers: ['PROPOSAL_NOT_FOUND'], drift }
  if (proposal.status !== 'accepted') blockers.push('PROPOSAL_NOT_ACCEPTED')

  const snapshot = await db.tradeExecutionSnapshot.findUnique({
    where: { tradeId: proposalId },
    select: { id: true, tradeSource: true, afterState: true, dependencies: true },
  })
  if (!snapshot) {
    // Everything settled before the native snapshot writer landed. A guessed "before" is not
    // evidence, so there is deliberately no fallback.
    blockers.push('NO_EXECUTION_SNAPSHOT')
    return { ok: false, blockers, drift }
  }
  if (snapshot.tradeSource !== 'redraft_native') blockers.push('SNAPSHOT_NOT_NATIVE')

  const existing = await db.tradeReversal.findUnique({ where: { tradeId: proposalId }, select: { id: true } })
  if (existing) blockers.push('ALREADY_REVERSED')

  // Rosters: current membership + FAAB must equal what the trade left behind.
  const after = readRosters(snapshot.afterState)
  const current = await captureRedraftRosterState(
    db as Prisma.TransactionClient,
    after.map((r) => r.rosterId),
  )
  for (const expected of after) {
    const actual = current.find((c) => c.rosterId === expected.rosterId)
    const e = fingerprint(expected)
    const a = actual ? fingerprint(actual) : 'ROSTER_MISSING'
    if (a !== e) {
      blockers.push('ROSTER_CHANGED_SINCE_EXECUTION')
      drift.push({ rosterId: expected.rosterId, expected: e, actual: a })
    }
  }

  // Cap: every salary record this trade moved must still be on the roster it was moved to. A cut,
  // an extension or a later trade that touched it makes putting it "back" wrong.
  const { moves, missing } = await readCapMoves(db, readSourceTransactionIds(snapshot.dependencies))
  if (missing) blockers.push('CAP_LEDGER_MISSING')
  for (const move of moves) {
    const rec = await db.iDPSalaryRecord.findFirst({
      where: { leagueId: proposal.leagueId, playerId: move.playerId, status: { in: ACTIVE_SALARY_STATUSES } },
      select: { rosterId: true },
    })
    if (!rec || rec.rosterId !== move.toRosterId) blockers.push('CAP_RECORD_MOVED_SINCE_EXECUTION')
  }

  return { ok: blockers.length === 0, blockers: [...new Set(blockers)], drift }
}

export type ReverseNativeTradeInput = {
  proposalId: string
  actorUserId: string
  actorRole: string
  reason: string
}

export type ReverseNativeTradeResult =
  | {
      ok: true
      reversalId: string
      eventId: string
      playersRestored: number
      capRecordsRestored: number
      /** Rosters touched, so the caller can refresh derived cap projections AFTER commit. */
      rosterIds: string[]
      /** `TradeReversal.noticeKey`, for the caller's post-commit league notice. */
      noticeKey: string
    }
  | { ok: false; readiness: NativeReversalReadiness }

export async function reverseNativeTrade(input: ReverseNativeTradeInput): Promise<ReverseNativeTradeResult> {
  const preflight = await evaluateNativeTradeReversalReadiness(prisma, input.proposalId)
  if (!preflight.ok) return { ok: false, readiness: preflight }

  try {
    return await prisma.$transaction(async (tx) => {
      // ⚠ THE CHECK THAT DECIDES. Everything the preflight read can change before this line.
      const readiness = await evaluateNativeTradeReversalReadiness(tx, input.proposalId)
      if (!readiness.ok) throw new NativeReversalRefused(readiness)

      const proposal = await tx.redraftTradeProposal.findUniqueOrThrow({
        where: { id: input.proposalId },
        select: { id: true, leagueId: true, seasonId: true },
      })
      const snapshot = await tx.tradeExecutionSnapshot.findUniqueOrThrow({
        where: { tradeId: input.proposalId },
        select: { id: true, beforeState: true, afterState: true, dependencies: true },
      })

      // Claim first, conditionally — the loser of a race throws before touching a roster.
      const claimed = await tx.redraftTradeProposal.updateMany({
        where: { id: proposal.id, status: 'accepted' },
        data: { status: 'reversed' },
      })
      if (claimed.count === 0) {
        throw new NativeReversalRefused({ ok: false, blockers: ['ALREADY_REVERSED'], drift: [] })
      }

      const before = readRosters(snapshot.beforeState)
      const after = readRosters(snapshot.afterState)

      // Players: only those whose roster differs between before and after moved in this trade.
      const original = new Map<string, { rosterId: string; slotType: string; acquisitionType: string }>()
      for (const r of before) {
        for (const p of r.players) {
          original.set(p.playerId, { rosterId: r.rosterId, slotType: p.slotType, acquisitionType: p.acquisitionType })
        }
      }

      let playersRestored = 0
      for (const r of after) {
        for (const p of r.players) {
          const orig = original.get(p.playerId)
          if (!orig || orig.rosterId === r.rosterId) continue
          // The exact inverse of settlement's `updateMany` — same WHERE shape, moving every matching
          // undropped row back. `isLocked` is deliberately untouched: the lock is derived at read time; see the header.
          const moved = await tx.redraftRosterPlayer.updateMany({
            where: { rosterId: r.rosterId, playerId: p.playerId, droppedAt: null },
            data: { rosterId: orig.rosterId, slotType: orig.slotType, acquisitionType: orig.acquisitionType },
          })
          if (moved.count === 0) {
            // Readiness just proved this player is on this roster; a zero here means the world moved
            // inside our own transaction. Refuse loudly rather than half-reverse.
            throw new Error(`Reversal could not find ${p.playerId} on roster ${r.rosterId}`)
          }
          playersRestored += 1
        }
      }

      // FAAB: readiness proved current == afterState, so writing beforeState is the exact inverse.
      for (const r of before) {
        await tx.redraftRoster.update({ where: { id: r.rosterId }, data: { faabBalance: r.faabBalance } })
      }

      // IDP cap: move each salary record back, then APPEND reversing ledger rows.
      const { moves } = await readCapMoves(tx, readSourceTransactionIds(snapshot.dependencies))
      const capReversalTransactionIds: string[] = []
      if (moves.length > 0) {
        const cfg = await tx.iDPCapConfig.findUnique({
          where: { leagueId: proposal.leagueId },
          select: { season: true },
        })
        if (!cfg) throw new Error('IDP cap configuration missing for a trade with cap dependencies')

        for (const move of moves) {
          const rec = await tx.iDPSalaryRecord.findFirstOrThrow({
            where: {
              leagueId: proposal.leagueId,
              playerId: move.playerId,
              rosterId: move.toRosterId,
              status: { in: ACTIVE_SALARY_STATUSES },
            },
          })
          await tx.iDPSalaryRecord.update({ where: { id: rec.id }, data: { rosterId: move.fromRosterId } })

          const notes = `Reversal of redraft trade ${proposal.id}`
          const out = await tx.iDPCapTransaction.create({
            data: {
              leagueId: proposal.leagueId,
              rosterId: move.toRosterId,
              playerId: rec.playerId,
              playerName: rec.playerName,
              isDefensive: rec.isDefensive,
              transactionType: 'trade_reversal_out',
              salary: rec.salary,
              contractYears: rec.yearsRemaining,
              deadMoneyCreated: 0,
              capImpact: -rec.salary,
              season: cfg.season,
              notes,
            },
          })
          const back = await tx.iDPCapTransaction.create({
            data: {
              leagueId: proposal.leagueId,
              rosterId: move.fromRosterId,
              playerId: rec.playerId,
              playerName: rec.playerName,
              isDefensive: rec.isDefensive,
              transactionType: 'trade_reversal_in',
              salary: rec.salary,
              contractYears: rec.yearsRemaining,
              deadMoneyCreated: 0,
              capImpact: rec.salary,
              season: cfg.season,
              notes,
            },
          })
          capReversalTransactionIds.push(out.id, back.id)
        }
      }

      const event = await getPlatformEvents().emitInTx(tx, EVENT.TRADE_CANCELED, {
        leagueId: proposal.leagueId,
        seasonId: proposal.seasonId,
        leagueConcept: 'redraft' as const,
        actor: { type: 'user' as const, id: input.actorUserId ?? null },
        source: 'route:trade-votes',
        subjects: [{ kind: 'trade', id: proposal.id }],
        idempotencyKey: `trade.reversed:${proposal.id}`,
        // `{ tradeId }` only — the TRADE_CANCELED payload schema in the event catalog admits nothing
        // else. The reason is not lost: it is a NOT NULL column on the TradeReversal row below.
        payload: { tradeId: proposal.id },
      })

      // Computed once: the row stores it and the caller dispatches the league notice with it.
      const noticeKey = `redraft_trade:${proposal.id}:reversed`
      const reversal = await tx.tradeReversal.create({
        data: {
          tradeId: proposal.id,
          snapshotId: snapshot.id,
          leagueId: proposal.leagueId,
          // Native trades DO belong to a RedraftSeason, unlike the generic path.
          seasonId: proposal.seasonId,
          actorId: input.actorUserId,
          actorRole: input.actorRole,
          reason: input.reason,
          idempotencyKey: `redraft-trade-reversal:${proposal.id}`,
          readiness: readiness as unknown as Prisma.InputJsonValue,
          restoredState: { rosters: before, capReversalTransactionIds } as unknown as Prisma.InputJsonValue,
          eventId: event.eventId,
          noticeKey,
          reversedAt: new Date(),
        },
        select: { id: true },
      })

      return {
        ok: true as const,
        reversalId: reversal.id,
        eventId: event.eventId,
        playersRestored,
        capRecordsRestored: moves.length,
        rosterIds: before.map((r) => r.rosterId),
        noticeKey,
      }
    })
  } catch (e) {
    if (e instanceof NativeReversalRefused) return { ok: false, readiness: e.readiness }
    throw e
  }
}

class NativeReversalRefused extends Error {
  readonly readiness: NativeReversalReadiness
  constructor(readiness: NativeReversalReadiness) {
    super(`Native trade reversal refused: ${readiness.blockers.join(', ')}`)
    this.name = 'NativeReversalRefused'
    this.readiness = readiness
  }
}
