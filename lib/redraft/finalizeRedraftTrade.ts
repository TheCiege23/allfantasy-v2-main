/**
 * Executes an agreed redraft trade: the one settlement every path uses — the receiver's accept under
 * `no_veto`, a commissioner's approval, a league vote reaching its approval threshold, and the review
 * window closing with no veto (lib/redraft/tradeReviewWindow.ts).
 *
 * Moved out of `app/api/redraft/trade-votes/route.ts` unchanged, so the hourly review-window sweep can
 * call the same code instead of a copy. The route wraps the result back into a response.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertPirateTradeAllowed } from '@/lib/pirate/tradeGuard'
import { isPirateLeague } from '@/lib/pirate/rules'
import {
  applyRedraftTradeCapTransfersInTransaction,
  refreshCapProjections,
  validateRedraftTradeCap,
  validateRedraftTradeCapInTransaction,
  type RedraftTradeCapTransferResult,
} from '@/lib/idp/capEngine'
import { settleRedraftTradeAssets } from '@/lib/redraft/tradeSettlement'
import { captureRedraftRosterState, writeRedraftTradeExecutionSnapshot } from '@/lib/redraft/tradeExecutionSnapshot'
import { getPlatformEvents, EVENT } from '@/lib/events'
import { recordRedraftTradeMarketEvent, type RedraftMarketEventType } from '@/lib/trade-market/redraftTradeMarketEvents'
import { enqueueCollusionScan } from '@/lib/integrity/enqueueCollusionScan'
import { recordTradeOutcomeForBothManagers } from '@/lib/ai-learning-system/recordTradeParticipants'
import { queueTradeStatusInDm } from '@/lib/chat-notifications/tradeOfferDm'

export type TradeAssetRow = {
  fromRosterId: string
  toRosterId: string
  assetType: string
  playerId: string | null
  playerName: string | null
  pickSeason: number | null
  pickRound: number | null
  pickNumber: number | null
  metadata: unknown
}

export type ProposalWithAssets = {
  id: string
  leagueId: string
  seasonId: string
  proposerRosterId: string
  receiverRosterId: string
  status: string
  vetoMode?: string | null
  vetoThreshold: number | null
  expiresAt: Date | null
  assets: TradeAssetRow[]
}

function mapLegacyOffers(assets: TradeAssetRow[], fromRosterId: string, toRosterId: string) {
  return assets
    .filter((a) => a.fromRosterId === fromRosterId && a.toRosterId === toRosterId)
    .map((a) => {
      if (a.assetType === 'player' && a.playerId) {
        return {
          playerId: a.playerId,
          playerName: a.playerName ?? null,
        }
      }
      return {
        assetType: a.assetType,
        pickSeason: a.pickSeason,
        pickRound: a.pickRound,
        pickNumber: a.pickNumber,
      }
    })
}

/**
 * Who executed the trade, for the snapshot's `executedByActorRole`.
 *
 * ⚠ PASSED EXPLICITLY, NOT DERIVED FROM `terminalEventType`. The first version of this derived the
 * role from that argument and could not work: there is no `vote_passed` market event, and the
 * league-vote path calls `finalizeAcceptedTrade` without a terminal type at all — so a trade voted
 * through by the league would have been recorded as an ordinary `user` accept. That is precisely
 * the governance blurring the execution-evidence ADR complains about.
 */
export type SnapshotActorRole = 'user' | 'commissioner' | 'league_vote' | 'review_window'

export type FinalizeRedraftTradeResult =
  | { ok: true; proposal: Awaited<ReturnType<typeof prisma.redraftTradeProposal.findUniqueOrThrow>> }
  | { ok: false; status: 409; error: string; alreadyResolved?: boolean }

/** The actor recorded when no person decided: the review window ended with no veto. */
export const REVIEW_WINDOW_ACTOR = 'system:trade-review-window'

export async function finalizeRedraftTrade(
  proposal: ProposalWithAssets,
  proposerOwnerId: string | undefined,
  receiverOwnerId: string | undefined,
  /** Null when no person decided — the review window closed (see lib/redraft/tradeReviewWindow.ts). */
  decidedByUserId: string | null,
  decisionReason?: string,
  terminalEventType: RedraftMarketEventType = 'proposal_accepted',
  executedByRole: SnapshotActorRole = 'user',
): Promise<FinalizeRedraftTradeResult> {
  const failEvent = () =>
    recordRedraftTradeMarketEvent({
      leagueId: proposal.leagueId,
      seasonId: proposal.seasonId,
      tradeProposalId: proposal.id,
      eventType: 'trade_failed',
      actorUserId: decidedByUserId,
    })
  const league = await prisma.league.findUnique({ where: { id: proposal.leagueId }, select: { leagueType: true, leagueVariant: true } })
  const pirateLeague = league != null && isPirateLeague(league)
  const proposerOffers = mapLegacyOffers(proposal.assets ?? [], proposal.proposerRosterId, proposal.receiverRosterId)
  const receiverOffers = mapLegacyOffers(proposal.assets ?? [], proposal.receiverRosterId, proposal.proposerRosterId)

  // A cheap early refusal, NOT the verdict that decides. The cap numbers it reads can change before
  // the transaction below opens, so the check is repeated on `tx` after the claim — see there.
  const cap = await validateRedraftTradeCap(
    proposal.leagueId,
    proposal.proposerRosterId,
    proposal.receiverRosterId,
    proposerOffers,
    receiverOffers,
  )
  if (!cap.ok) {
    await failEvent()
    return { ok: false, status: 409, error: cap.message }
  }

  // Settle the trade for real, in ONE transaction: claim the proposal, move the IDP salary records,
  // move RedraftRosterPlayer rows, transfer faabBalance. Either all of it happens or none of it does.
  //
  // 🛑 THE CAP TRANSFER USED TO RUN HERE, BEFORE THIS TRANSACTION OPENED, AND IT BROKE TWO WAYS.
  // `applyRedraftTradeCapTransfers` opens its own transaction, so the cap moves were atomic among
  // themselves and atomic with nothing else:
  //   - A settlement that then threw (bad ownership, insufficient FAAB) left the IDP cap saying the
  //     trade happened while the rosters said it had not. Nothing rolled the salary records back.
  //   - Worse, the claim that decides which of two racing finalizers wins lived in THIS transaction,
  //     below — so both racers ran the cap transfer first and moved salary TWICE, and the loser then
  //     returned 409 having already written.
  // Running it after the claim, on the same `tx`, closes both: the loser never reaches it, and a
  // later throw rolls it back with everything else.
  let updated
  let capTransfer: RedraftTradeCapTransferResult = { moved: 0, transactionIds: [] }
  try {
    updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Concurrency guard: atomically claim the proposal BEFORE moving any rosters.
      // A conditional update on status='pending' ensures only one of two racing
      // finalizers (double-click, vote-threshold vs. commissioner-approve) settles.
      const claimed = await tx.redraftTradeProposal.updateMany({
        where: { id: proposal.id, status: 'pending' },
        data: { status: 'accepted', acceptedAt: new Date(), processedAt: new Date() },
      })
      if (claimed.count === 0) {
        throw new Error('PROPOSAL_ALREADY_RESOLVED')
      }
      if (pirateLeague) await assertPirateTradeAllowed(proposal.leagueId, (proposal.assets ?? []).map((asset) => ({
        fromRosterId: asset.fromRosterId, assetType: asset.assetType, playerId: asset.playerId,
      })), tx)
      // 🛑 THE CAP CHECK THAT DECIDES, ON THE SETTLEMENT'S OWN TRANSACTION.
      //
      // The only cap check used to be the one above, run before this transaction existed. Anything
      // that changed committed salary in between — another settlement, a cut, an extension — was
      // invisible to it, so a trade could settle on a verdict computed against numbers that were no
      // longer true. #742 moved the cap TRANSFER in here and named this as the gap it left.
      //
      // After the claim (only the race winner pays for the reads), before the transfer (so what it
      // approves is exactly what then moves). A refusal throws, the transaction rolls back including
      // the claim, and the catch below answers 409 with the message — the same shape as the early one.
      const capInTx = await validateRedraftTradeCapInTransaction(
        tx,
        proposal.leagueId,
        proposal.proposerRosterId,
        proposal.receiverRosterId,
        proposerOffers,
        receiverOffers,
      )
      if (!capInTx.ok) {
        throw new Error(capInTx.message)
      }
      // ⚠ BEFORE-STATE IS READ HERE AND NOWHERE LATER. Inside one transaction these rows stop
      // being "before" the moment the settlement writes them, so the evidence has to be taken
      // after the claim (only the race winner gets this far) and before anything moves.
      const beforeState = await captureRedraftRosterState(tx, [
        proposal.proposerRosterId,
        proposal.receiverRosterId,
      ])
      capTransfer = await applyRedraftTradeCapTransfersInTransaction(
        tx,
        proposal.leagueId,
        proposal.proposerRosterId,
        proposal.receiverRosterId,
        proposerOffers,
        receiverOffers,
      )
      const settlement = await settleRedraftTradeAssets(tx, {
        leagueId: proposal.leagueId,
        proposerRosterId: proposal.proposerRosterId,
        receiverRosterId: proposal.receiverRosterId,
        assets: proposal.assets ?? [],
      })

      // IMMUTABLE EVIDENCE, WRITTEN WITH THE TRADE RATHER THAN AFTER IT.
      //
      // 🛑 `TradeExecutionSnapshot` had NO writer anywhere in this codebase — the model, its
      // `TradeReversal` counterpart and the documents describing both were all on main, and not one
      // row was ever created. A reversal had nothing to restore to.
      //
      // ⚠ This also MOVES the `TRADE_PROCESSED` emit into the transaction (same deterministic
      // idempotency key), because the snapshot's `eventId` is NOT NULL and unique: evidence that
      // points at an event which may never have been written is not evidence. The post-commit emit
      // below now sends only TRADE_ACCEPTED.
      await writeRedraftTradeExecutionSnapshot(tx, {
        proposalId: proposal.id,
        leagueId: proposal.leagueId,
        seasonId: proposal.seasonId,
        proposerRosterId: proposal.proposerRosterId,
        receiverRosterId: proposal.receiverRosterId,
        executedByActorId: decidedByUserId ?? REVIEW_WINDOW_ACTOR,
        executedByActorRole: executedByRole,
        governance: {
          vetoMode: proposal.vetoMode ?? null,
          vetoThreshold: proposal.vetoThreshold ?? null,
          terminalEventType,
          decisionReason: decisionReason ?? null,
        },
        validations: { idpCap: 'ok', capTransfersApplied: capTransfer.moved },
        assetSummary: {
          proposerOffers,
          receiverOffers,
          playersMoved: settlement.playersMoved,
          faabTransferred: settlement.faabTransferred,
          picksRecorded: settlement.picksRecorded,
        },
        sourceTransactionIds: capTransfer.transactionIds,
        beforeState,
        afterState: await captureRedraftRosterState(tx, [
          proposal.proposerRosterId,
          proposal.receiverRosterId,
        ]),
        executedAt: new Date(),
      })

      return tx.redraftTradeProposal.findUniqueOrThrow({ where: { id: proposal.id } })
    })
  } catch (e) {
    // Lost the race — another finalizer already settled this proposal. Do not
    // record a spurious failure or re-settle.
    if (e instanceof Error && e.message === 'PROPOSAL_ALREADY_RESOLVED') {
      return { ok: false, status: 409, error: 'Proposal already resolved', alreadyResolved: true }
    }
    await failEvent()
    return { ok: false, status: 409, error: e instanceof Error ? e.message : 'Trade settlement failed' }
  }
  await upsertRedraftTradeDecision(proposal.id, 'accepted', decidedByUserId, decisionReason)

  // POST-COMMIT, and deliberately not inside the transaction above. `IDPCapProjection` is a derived
  // view; recomputing it from inside would publish projections for a settlement that can still roll
  // back. `applyRedraftTradeCapTransfers` — the non-transactional version this path used to call —
  // refreshed post-commit for the same reason, so omitting it here would silently regress projection
  // freshness on every redraft trade while the ledger stayed correct and nothing went red.
  //
  // Best-effort: the trade is already committed and a stale projection must not turn a settled trade
  // into an error response.
  if (capTransfer.moved > 0) {
    for (const rosterId of new Set([proposal.proposerRosterId, proposal.receiverRosterId])) {
      await refreshCapProjections(proposal.leagueId, rosterId).catch((e) =>
        console.error('[redraft/trade-votes] cap projection refresh failed', rosterId, e),
      )
    }
  }

  // G15.2b — best-effort emit (never throws; only the race-winning finalizer reaches here,
  // and deterministic keys dedupe → exactly one accepted+processed event per trade).
  {
    const events = getPlatformEvents()
    const ctx = {
      leagueId: proposal.leagueId,
      seasonId: proposal.seasonId,
      leagueConcept: 'redraft' as const,
      actor: decidedByUserId ? { type: 'user' as const, id: decidedByUserId } : { type: 'system' as const },
      source: 'route:trade-votes',
      subjects: [{ kind: 'trade', id: proposal.id }],
    }
    await events.emit(EVENT.TRADE_ACCEPTED, { ...ctx, idempotencyKey: `trade.accepted:${proposal.id}`, payload: { tradeId: proposal.id } })
    // ⚠ TRADE_PROCESSED IS NO LONGER EMITTED HERE. It moved into the settlement transaction, under
    // the SAME deterministic key, because `TradeExecutionSnapshot.eventId` is NOT NULL and unique —
    // the snapshot cannot reference an event that a best-effort post-commit emit might never write.
    // Re-adding it here would either duplicate the event or, worse, look like the only emit.
  }

  if (proposerOwnerId && receiverOwnerId) {
    void recordTradeOutcomeForBothManagers({
      leagueId: proposal.leagueId,
      eventType: 'trade_accepted',
      proposerUserId: proposerOwnerId,
      receiverUserId: receiverOwnerId,
      payload: { proposalId: proposal.id, source: 'redraft_trade_proposal' },
    })
  }

  if (proposerOwnerId && receiverOwnerId) {
    await prisma.redraftLeagueTrade.create({
      data: {
        leagueId: proposal.leagueId,
        seasonId: proposal.seasonId,
        proposerId: proposerOwnerId,
        proposerRosterId: proposal.proposerRosterId,
        receiverId: receiverOwnerId,
        receiverRosterId: proposal.receiverRosterId,
        proposerOffers,
        receiverOffers,
        status: 'accepted',
        processedAt: new Date(),
        expiresAt: proposal.expiresAt ?? new Date(),
        notes: 'Normalized proposal accepted and mirrored for legacy readers (the redraft trades list)',
      },
    })
  }
  // The integrity scan reviews the proposal itself — the real trade, through the one trade engine.
  // Wrapped so neither a sync throw nor a rejection can reach a trade that has already settled.
  void Promise.resolve()
    .then(() => enqueueCollusionScan(proposal.leagueId, { kind: 'redraft', proposalId: proposal.id }, [proposal.proposerRosterId, proposal.receiverRosterId]))
    .catch((e) => console.error('[redraft/trade-votes] enqueueCollusionScan failed', e))

  // Market ledger: terminal acceptance event + processed event (best-effort, idempotent).
  await recordRedraftTradeMarketEvent({
    leagueId: proposal.leagueId, seasonId: proposal.seasonId, tradeProposalId: proposal.id,
    eventType: terminalEventType, actorUserId: decidedByUserId,
  })
  await recordRedraftTradeMarketEvent({
    leagueId: proposal.leagueId, seasonId: proposal.seasonId, tradeProposalId: proposal.id,
    eventType: 'trade_processed', actorUserId: decidedByUserId,
  })

  // The result, under the offer card in the two managers' DM. Fire-and-forget; no-op when there is no card.
  // A receiver's own accept names them; a commissioner approval or a passed league vote says who decided.
  queueTradeStatusInDm(
    executedByRole === 'user'
      ? { source: 'redraft', tradeId: proposal.id, status: 'accepted', actorUserId: decidedByUserId, detail: 'Rosters are updated.' }
      : {
          source: 'redraft',
          tradeId: proposal.id,
          status: 'processed',
          detail:
            executedByRole === 'commissioner'
              ? 'The commissioner approved it.'
              : executedByRole === 'review_window'
                ? 'The review window ended with no veto.'
                : 'The league vote approved it.',
        },
  )

  return { ok: true, proposal: updated }
}

/** A decision snapshot as an object, whatever was stored. */
export function snapshotObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function upsertRedraftTradeDecision(
  proposalId: string,
  decision: 'accepted' | 'rejected' | 'vetoed' | 'cancelled' | 'expired' | 'processed',
  decidedByUserId: string | null,
  decisionReason?: string,
  /** Merged into the decision's snapshot — e.g. the commissioner review that was shown. */
  snapshotExtra?: Record<string, unknown>,
) {
  const existing = await prisma.redraftTradeDecision.findFirst({ where: { proposalId } })
  if (existing) {
    return prisma.redraftTradeDecision.update({
      where: { proposalId },
      data: {
        decision,
        decidedByUserId,
        decisionReason: decisionReason ?? null,
        ...(snapshotExtra ? { snapshot: { ...snapshotObject(existing.snapshot), ...snapshotExtra } as Prisma.InputJsonValue } : {}),
      },
    })
  }

  return prisma.redraftTradeDecision.create({
    data: {
      id: crypto.randomUUID(),
      proposalId,
      decision,
      decidedByUserId,
      decisionReason: decisionReason ?? null,
      snapshot: (snapshotExtra ?? {}) as Prisma.InputJsonValue,
    },
  })
}
