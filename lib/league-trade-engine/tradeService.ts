/**
 * AF league trade orchestration — create, accept, reject, counter, veto, commissioner, process.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assertLifecycleActionAllowed } from '@/server/services/leagueLifecycleService'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { validateTradeAssets } from '@/lib/league-trade-engine/tradeValidationService'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { applyTradeAssetsInTransaction } from '@/lib/league-trade-engine/tradeProcessor'
import { loadNativeFuturePicks, parseInventoryPickId } from '@/lib/league-trade-engine/nativeFuturePicks'
import {
  captureGenericRosterState,
  genericTradeActorRole,
  writeGenericTradeExecutionSnapshot,
} from '@/lib/league-trade-engine/tradeExecutionSnapshot'
import {
  appendAfTradeProcessingEvent,
  appendAfTradeStatusHistory,
  logAfTradeAudit,
} from '@/lib/league-trade-engine/tradeAudit'
import type { CreateLeagueTradeInput, TradeAssetInput } from '@/lib/league-trade-engine/types'
import { assertRosterTransactionsAllowed } from '@/lib/roster-legality/rosterTransactionGates'
import { ENGAGEMENT } from '@/lib/analytics/eventNames'
import { recordProductEvent } from '@/lib/analytics/recordAnalyticsEvent'
import { captureLiveTradeOffer, captureLiveTradeOutcome } from '@/lib/league-trade-engine/tradeLearningCapture'
import { getTradeManagerStrategy } from '@/lib/league-trade-engine/managerStrategy'
import {
  buildTradeDecisionSnapshot,
  writeTradeDecisionSnapshot,
} from '@/lib/league-trade-engine/tradeDecisionSnapshot'
import type { VerifiedProposalEvidence } from '@/lib/league-trade-engine/proposalEvidenceToken'
import { evaluateServerTradeDecision } from '@/lib/league-trade-engine/serverTradeDecision'

async function fanout(leagueId: string, input: {
  eventType: string
  title: string
  message: string
  actorUserId?: string | null
  meta?: Record<string, unknown>
  dedupeKey?: string
}) {
  const { publishLeagueFanoutEvent } = await import('@/lib/league-events/publisher')
  await publishLeagueFanoutEvent({
    leagueId,
    eventType: input.eventType,
    title: input.title,
    message: input.message,
    category: 'league_announcements',
    visibility: 'all_members',
    actorUserId: input.actorUserId,
    meta: input.meta,
    dedupeKey: input.dedupeKey,
  }).catch(() => {})
}

function mapReviewToTradeReviewType(mode: string): string {
  if (mode === 'instant' || mode === 'none') return 'instant'
  if (mode === 'league_vote') return 'league_vote'
  return 'commissioner'
}

async function managedPlatformIds(leagueId: string, userId: string): Promise<Set<string>> {
  const ids = new Set<string>([userId])
  const client = prisma as typeof prisma & {
    leagueTeam?: typeof prisma.leagueTeam
    userProfile?: typeof prisma.userProfile
  }
  const [claimed, profile] = await Promise.all([
    client.leagueTeam
      ? client.leagueTeam
      .findFirst({ where: { leagueId, claimedByUserId: userId }, select: { platformUserId: true } })
      .catch(() => null)
      : Promise.resolve(null),
    client.userProfile
      ? client.userProfile
      .findUnique({ where: { userId }, select: { sleeperUserId: true } })
      .catch(() => null)
      : Promise.resolve(null),
  ])
  if (claimed?.platformUserId) ids.add(claimed.platformUserId)
  if (profile?.sleeperUserId) ids.add(profile.sleeperUserId)
  return ids
}

/**
 * Direct notice to the PROPOSER when their offer is accepted or rejected — the
 * `trade_accept_reject` settings category. The league-wide `fanout` above goes
 * out as `league_announcements`; before this, the accept/reject toggle in
 * notification settings governed an event no code fired. Dynamic import (same
 * pattern as `fanout`) and fire-and-forget: a notification failure must never
 * fail the trade action itself.
 */
async function notifyProposerOfDecision(input: {
  leagueId: string
  tradeId: string
  proposerUserId: string
  type: 'trade_accepted' | 'trade_rejected'
  title: string
  body?: string
}) {
  const { ingest, tradeEvent } = await import('@/lib/notification-engine')
  await ingest(
    tradeEvent({
      userIds: [input.proposerUserId],
      leagueId: input.leagueId,
      type: input.type,
      tradeId: input.tradeId,
      title: input.title,
      body: input.body,
    }),
  ).catch(() => {})
}

type PlannedTradeNotice = {
  userId: string
  type: 'trade_proposed' | 'trade_countered'
  title: string
  body: string
}

/**
 * Creation-time direct notices. Up to two DIFFERENT people can need telling when
 * a trade is created:
 *
 *   the receiver of the new offer                 ->  trade_proposed
 *   the proposer of the offer this one COUNTERS   ->  trade_countered
 *
 * Before this, neither fired. `createAfLeagueTrade` sent one league-wide
 * `af_trade_proposed` fanout to `all_members` and nothing addressed to anyone —
 * so a countered proposer watched their offer go to status 'countered' with no
 * notice at all, and `trade_proposed` was a settings category no code fired.
 * That is the same defect `notifyProposerOfDecision` above was written to fix
 * for accept/reject.
 *
 * 🛑 THE TWO RULES NORMALLY SELECT THE SAME PERSON, AND THAT IS THE DIFFICULTY.
 * You counter whoever offered to you, so a naive implementation pushes twice for
 * one action by one person at one instant.
 *
 * ⚠ AND `if (isCounter) skip the proposal notice` IS THE WRONG FIX, which is why
 * this dedupes instead. The counter route takes proposerRosterId/receiverRosterId
 * from the REQUEST BODY rather than deriving them from the parent, so a counter
 * aimed at a third roster is reachable — and there, two notices to two different
 * people is the correct outcome. Deduping by userId is right in both cases; a
 * branch on "is this a counter" is right only in the common one.
 *
 * ⚠ ORDER IS THE TIE-BREAK, NOT DECORATION. `trade_countered` is planned FIRST so
 * it wins when both rules name one person: it is the more specific fact, and the
 * only one that explains why that person's own offer just disappeared. Swap the
 * two pushes and the common case silently degrades to a generic "new offer".
 *
 * Fire-and-forget, like every other notify path here: a notification failure must
 * never fail the trade itself.
 */
async function notifyOnTradeCreated(input: {
  leagueId: string
  newTradeId: string
  actorUserId: string
  receiverUserIds: string[]
  counteredProposerUserId: string | null
}) {
  const planned: PlannedTradeNotice[] = []

  if (input.counteredProposerUserId) {
    planned.push({
      userId: input.counteredProposerUserId,
      type: 'trade_countered',
      title: 'Your trade offer was countered',
      body: 'They sent one back — open it to accept, counter again, or decline.',
    })
  }
  for (const receiverUserId of input.receiverUserIds) {
    planned.push({
      userId: receiverUserId,
      type: 'trade_proposed',
      title: 'New trade offer',
      body: 'Someone in your league sent you a trade offer.',
    })
  }

  /*
   * Seeded with the actor: countering your own offer, or proposing to a roster you
   * own, must not notify you about your own action. An unclaimed roster has a null
   * platformUserId and is simply absent from `planned`.
   */
  const claimed = new Set<string>([input.actorUserId])
  const recipients: PlannedTradeNotice[] = []
  for (const notice of planned) {
    if (claimed.has(notice.userId)) continue
    claimed.add(notice.userId)
    recipients.push(notice)
  }
  if (recipients.length === 0) return

  const { ingest, tradeEvent } = await import('@/lib/notification-engine')
  for (const notice of recipients) {
    await ingest(
      tradeEvent({
        userIds: [notice.userId],
        leagueId: input.leagueId,
        type: notice.type,
        /*
         * Always the NEW trade. For a counter the parent is already dead (status
         * 'countered'), so carrying its id would point the recipient at the one
         * offer they can no longer act on.
         */
        tradeId: input.newTradeId,
        title: notice.title,
        body: notice.body,
      }),
    ).catch(() => {})
  }
}

/**
 * Why a counter to `parent` must be refused, or null when it may go ahead. PURE.
 *
 * 🛑 THE LOOPHOLE (audit 2026-09-24). A counter looked the parent up by id and league and nothing
 * else, then set it to 'countered' unconditionally. So ANY league member — anyone who owns a roster,
 * which the proposer check below proves and nothing more — could "counter" a trade between two other
 * managers and kill it, and could do it to a trade that was already accepted, awaiting review, or
 * processed. The counter route takes both roster ids from the request body, so no UI was needed.
 *
 * A counter is an answer to an offer, so it takes the rules an answer takes (accept and reject):
 *   - the offer is still PENDING and has not expired;
 *   - it comes from a roster the offer was made TO — not the roster that proposed it, which
 *     withdraws its offer rather than countering it, and not a roster outside the trade.
 * Ownership of that roster is proven by the caller's own proposer check on `proposerRosterId`.
 *
 * ⚠ WHERE THE COUNTER GOES IS DELIBERATELY NOT RESTRICTED. A counter aimed at a third roster is
 * reachable and has tested notification semantics (`counter-notification-dispatch.test.ts`); it is
 * no loophole, because the counterer was offered the parent and could reject it anyway.
 */
export function counterRefusal(
  parent: {
    status: string
    expiresAt?: Date | null
    proposerRosterId: string
    receiverRosterId: string
    items?: Array<{ fromRosterId: string; toRosterId: string }> | null
  },
  counterProposerRosterId: string,
  now: Date = new Date(),
): string | null {
  if (parent.status !== 'pending') return 'Only a pending trade can be countered'
  if (parent.expiresAt && parent.expiresAt < now) return 'Trade expired'
  const offeredTo = new Set([
    parent.receiverRosterId,
    ...(parent.items ?? []).flatMap((i) => [i.fromRosterId, i.toRosterId]),
  ])
  offeredTo.delete(parent.proposerRosterId)
  if (!offeredTo.has(counterProposerRosterId)) {
    return 'Only a manager this trade was offered to can counter it'
  }
  return null
}

type TradeWriter = Pick<typeof prisma, 'afLeagueTrade'>

/**
 * Close the parent as 'countered' — but only if it is STILL pending when the counter is written.
 *
 * ⚠ A CONDITIONAL CLAIM, NOT A READ-THEN-WRITE. The status was checked when the parent was read, and
 * accept runs concurrently: an unconditional update here would overwrite a trade accepted between
 * that read and this write. Cancel and settlement claim the same way. On the production path this
 * runs in the counter's own transaction, so losing the race rolls the counter back with it.
 */
async function claimParentForCounter(db: TradeWriter, parentId: string): Promise<void> {
  const claimed = await db.afLeagueTrade.updateMany({
    where: { id: parentId, status: 'pending' },
    data: { status: 'countered' },
  })
  if (claimed.count === 0) throw new Error('This trade changed before your counter was sent — reload it and try again')
}

async function linkCounterToParent(
  db: TradeWriter,
  parent: { id: string; metadata: Prisma.JsonValue | null },
  counterTradeId: string,
): Promise<void> {
  await db.afLeagueTrade.update({
    where: { id: parent.id },
    data: { metadata: { ...((parent.metadata as object | null) ?? {}), counterTradeId } as Prisma.InputJsonValue },
  })
}

export async function createAfLeagueTrade(input: CreateLeagueTradeInput & {
  currentWeek?: number | null
  verifiedProposalEvidence?: VerifiedProposalEvidence | null
}): Promise<{ id: string }> {
  const league = await prisma.league.findUnique({ where: { id: input.leagueId } })
  if (!league) throw new Error('League not found')

  const life = await assertLifecycleActionAllowed(input.leagueId, 'trade_act', input.proposedByUserId, {
    isElevatedCommissioner: await isElevatedCommissioner(input.leagueId, input.proposedByUserId),
  })
  if (!life.ok) throw new Error(life.err.error)

  const participantRosterIds = [...new Set([
    input.proposerRosterId,
    input.receiverRosterId,
    ...input.assets.flatMap((a) => [a.fromRosterId, a.toRosterId]),
  ])]
  const participants = participantRosterIds.length === 2
    ? (await Promise.all([
        prisma.roster.findFirst({ where: { id: input.proposerRosterId, leagueId: input.leagueId } }),
        prisma.roster.findFirst({ where: { id: input.receiverRosterId, leagueId: input.leagueId } }),
      ])).filter((r): r is NonNullable<typeof r> => Boolean(r))
    : await prisma.roster.findMany({ where: { id: { in: participantRosterIds }, leagueId: input.leagueId } })
  const proposer = participants.find((r) => r.id === input.proposerRosterId) ?? null
  const receiver = participants.find((r) => r.id === input.receiverRosterId) ?? null
  if (!proposer || !receiver) throw new Error('Roster not found')
  if (participants.length !== participantRosterIds.length) throw new Error('Every trade participant must belong to this league')
  const proposerOwnsRoster = proposer.platformUserId === input.proposedByUserId
    || (await managedPlatformIds(input.leagueId, input.proposedByUserId)).has(proposer.platformUserId)
  if (!proposerOwnsRoster) {
    throw new Error('Proposer must own the proposing roster')
  }

  const rosterTxGate = await assertRosterTransactionsAllowed({
    leagueId: input.leagueId,
    league,
    rosterIds: participantRosterIds,
    userId: input.proposedByUserId,
    kind: 'trade',
  })
  if (!rosterTxGate.ok) throw new Error(rosterTxGate.error)

  const settings = resolveLeagueTradeSettings(league)
  // A native dynasty league's future picks are checked against its inventory, not `playerData`.
  const offersNativePick = input.assets.some((a) => parseInventoryPickId(String(a.itemReference ?? '')) != null)
  const nativePicks = offersNativePick ? await loadNativeFuturePicks(input.leagueId).catch(() => null) : null
  const v = validateTradeAssets({
    league,
    settings,
    proposer,
    receiver,
    participants,
    assets: input.assets,
    currentWeek: input.currentWeek ?? null,
    nativeFuturePickOwners: nativePicks?.ownerByPickId ?? null,
  })
  if (!v.ok) throw new Error(v.message)

  const expiresHours = input.expiresInHours ?? 48
  const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000)
  const reviewType = mapReviewToTradeReviewType(settings.tradeReviewMode)

  const parent = input.parentTradeId
    ? await prisma.afLeagueTrade.findFirst({
        where: { id: input.parentTradeId, leagueId: input.leagueId },
        include: { items: true },
      })
    : null
  if (input.parentTradeId && !parent) throw new Error('Parent trade not found')
  if (parent) {
    const refusal = counterRefusal(parent, input.proposerRosterId)
    if (refusal) throw new Error(refusal)
  }

  const rootId = parent?.rootTradeId ?? parent?.id ?? null

  // Runs for suggested and fully custom packages. The result is frozen in the
  // same transaction as the trade; failures degrade the receipt instead of
  // blocking a legal offer.
  const serverDecisionResult = await evaluateServerTradeDecision({
    leagueId: input.leagueId,
    proposerRosterId: input.proposerRosterId,
    receiverRosterId: input.receiverRosterId,
    participantRosterIds,
    assets: input.assets,
    season: league.season,
    proposedByUserId: input.proposedByUserId,
  })

  const createData = {
      leagueId: input.leagueId,
      proposedByUserId: input.proposedByUserId,
      proposerRosterId: input.proposerRosterId,
      receiverRosterId: input.receiverRosterId,
      parentTradeId: input.parentTradeId ?? null,
      rootTradeId: rootId,
      status: 'pending',
      reviewType,
      processingDelayHours: settings.processingDelayHours,
      vetoThresholdPercent: settings.vetoThresholdPercent,
      expiresAt,
      metadata: {
        ...(input.metadata ?? {}),
        participantRosterIds,
        acceptedRosterIds: [],
        multiTeam: participantRosterIds.length > 2,
      } as Prisma.InputJsonValue,
      items: {
        create: input.assets.map((a) => {
          // A native future pick's item carries its own season and round, read from its id, so
          // every reader of the item (grades, history, notices) can price it without the id format.
          const nativePick = parseInventoryPickId(String(a.itemReference ?? ''))
          return {
            itemType: a.itemType,
            itemReference: a.itemReference ?? null,
            fromRosterId: a.fromRosterId,
            toRosterId: a.toRosterId,
            faabAmount: a.faabAmount ?? null,
            metadata: (nativePick
              ? {
                  ...(a.metadata ?? {}),
                  pickSeason: nativePick.season,
                  pickRound: nativePick.round,
                  originalRosterId: nativePick.originalRosterId,
                }
              : (a.metadata ?? {})) as Prisma.InputJsonValue,
          }
        }),
      },
    } satisfies Prisma.AfLeagueTradeUncheckedCreateInput

  const decisionStore = (prisma as typeof prisma & {
    tradeDecisionSnapshot?: typeof prisma.tradeDecisionSnapshot
    tradeManagerStrategy?: typeof prisma.tradeManagerStrategy
  }).tradeDecisionSnapshot
  const managerStore = (prisma as typeof prisma & {
    tradeManagerStrategy?: typeof prisma.tradeManagerStrategy
  }).tradeManagerStrategy

  // Production uses one transaction so a trade can never exist without its
  // proposal-time receipt. Reduced test clients without the new delegate keep
  // exercising the legacy creation path until their generated client updates.
  const trade = decisionStore
    ? await prisma.$transaction(async (tx) => {
        // The claim comes first, so a lost race rolls the counter back rather than orphaning it.
        if (parent) await claimParentForCounter(tx, parent.id)
        const created = await tx.afLeagueTrade.create({ data: createData })
        if (parent) await linkCounterToParent(tx, parent, created.id)
        const managerStrategy = managerStore
          ? await getTradeManagerStrategy(input.leagueId, input.proposedByUserId, {
              tradeManagerStrategy: tx.tradeManagerStrategy,
            })
          : null
        // A manager can change strategy after opening the builder. In that case
        // the old signed package remains authentic but no longer represents the
        // user's current plan, so preserve the trade with a partial receipt.
        const verifiedProposalEvidence = input.verifiedProposalEvidence
          && managerStrategy?.active === input.verifiedProposalEvidence.managerStrategy
          ? input.verifiedProposalEvidence
          : null
        const snapshot = buildTradeDecisionSnapshot({
          league,
          rosters: participants,
          assets: input.assets,
          proposedByUserId: input.proposedByUserId,
          managerStrategy,
          tradeSettings: settings as unknown as Record<string, unknown>,
          metadata: input.metadata,
          verifiedProposalEvidence,
          serverDecisionResult,
        })
        await writeTradeDecisionSnapshot(tx, {
          tradeId: created.id,
          leagueId: input.leagueId,
          proposedByUserId: input.proposedByUserId,
          snapshot,
        })
        return created
      })
    : await (async () => {
        if (parent) await claimParentForCounter(prisma, parent.id)
        const created = await prisma.afLeagueTrade.create({ data: createData })
        if (parent) await linkCounterToParent(prisma, parent, created.id)
        return created
      })()

  await appendAfTradeStatusHistory({
    tradeId: trade.id,
    fromStatus: null,
    toStatus: 'pending',
    actorUserId: input.proposedByUserId,
    reason: 'created',
  })
  await appendAfTradeProcessingEvent({ tradeId: trade.id, eventType: 'trade_created', payload: { assets: input.assets.length } })
  await logAfTradeAudit({
    leagueId: input.leagueId,
    userId: input.proposedByUserId,
    actionType: 'af_trade_created',
    tradeId: trade.id,
    afterState: { status: 'pending' },
  })

  // Trade Learning Phase 8 live capture (docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md):
  // logs this real proposal's acceptance-probability prediction. Fails safe —
  // never throws, never blocks trade creation.
  await captureLiveTradeOffer({
    tradeId: trade.id,
    leagueId: input.leagueId,
    proposerRosterId: input.proposerRosterId,
    receiverRosterId: input.receiverRosterId,
    items: input.assets,
    league,
    // The learning record carries the same letter as the receipt — the one grade, not a fourth rule.
    oneGradeLetter: serverDecisionResult?.participants?.find((p) => p.rosterId === input.proposerRosterId)?.grade ?? null,
  })

  if (input.parentTradeId && parent) {
    // The status and the counter link were written with the counter itself — see claimParentForCounter.
    await appendAfTradeStatusHistory({
      tradeId: parent.id,
      fromStatus: parent.status,
      toStatus: 'countered',
      actorUserId: input.proposedByUserId,
      reason: 'counter_offer',
    })
    await captureLiveTradeOutcome({ tradeId: parent.id, leagueId: input.leagueId, status: 'countered' })
  }

  await fanout(input.leagueId, {
    eventType: 'af_trade_proposed',
    title: 'New trade proposal',
    message: 'A trade has been proposed in your league.',
    actorUserId: input.proposedByUserId,
    meta: { tradeId: trade.id },
    dedupeKey: `af_trade:${trade.id}:created`,
  })

  /*
   * The fanout above is `league_announcements` / `all_members` — every manager gets
   * the same unaddressed line. These are the addressed notices: they name a person
   * and land in the trade categories that person's settings actually govern.
   *
   * `parent` is non-null exactly when this creation countered something: a set
   * `parentTradeId` that does not resolve throws above, so there is no third state.
   */
  await notifyOnTradeCreated({
    leagueId: input.leagueId,
    newTradeId: trade.id,
    actorUserId: input.proposedByUserId,
    receiverUserIds: participants
      .filter((r) => r.id !== proposer.id)
      .map((r) => r.platformUserId)
      .filter((id): id is string => Boolean(id)),
    counteredProposerUserId: parent?.proposedByUserId ?? null,
  })

  return { id: trade.id }
}

export async function acceptAfLeagueTrade(input: {
  tradeId: string
  userId: string
  leagueId: string
}): Promise<{ status: string }> {
  const trade = await prisma.afLeagueTrade.findFirst({
    where: { id: input.tradeId, leagueId: input.leagueId },
    include: { items: true },
  })
  if (!trade) throw new Error('Trade not found')
  if (trade.status !== 'pending') throw new Error('Trade is not pending')
  if (trade.expiresAt && trade.expiresAt < new Date()) throw new Error('Trade expired')

  const participantRosterIds = [...new Set([
    trade.proposerRosterId,
    trade.receiverRosterId,
    ...trade.items.flatMap((i) => [i.fromRosterId, i.toRosterId]),
  ])]
  const participants = await prisma.roster.findMany({ where: { id: { in: participantRosterIds }, leagueId: input.leagueId } })
  let acceptingRoster = participants.find((r) => r.id !== trade.proposerRosterId && r.platformUserId === input.userId)
  if (!acceptingRoster) {
    const acceptingIdentityIds = await managedPlatformIds(input.leagueId, input.userId)
    acceptingRoster = participants.find((r) => r.id !== trade.proposerRosterId && acceptingIdentityIds.has(r.platformUserId))
  }
  if (!acceptingRoster) throw new Error('Only a participating manager can accept')

  const metadata = trade.metadata && typeof trade.metadata === 'object' && !Array.isArray(trade.metadata)
    ? trade.metadata as Record<string, unknown>
    : {}
  const accepted = new Set(Array.isArray(metadata.acceptedRosterIds) ? metadata.acceptedRosterIds.map(String) : [])
  accepted.add(acceptingRoster.id)
  const requiredAcceptances = participantRosterIds.filter((id) => id !== trade.proposerRosterId)
  if (!requiredAcceptances.every((id) => accepted.has(id))) {
    await prisma.afLeagueTrade.update({
      where: { id: trade.id },
      data: { metadata: { ...metadata, participantRosterIds, acceptedRosterIds: [...accepted], multiTeam: participantRosterIds.length > 2 } as Prisma.InputJsonValue },
    })
    await appendAfTradeStatusHistory({
      tradeId: trade.id,
      fromStatus: 'pending',
      toStatus: 'pending',
      actorUserId: input.userId,
      reason: 'participant_accepted',
      metadata: { acceptingRosterId: acceptingRoster.id, accepted: accepted.size, required: requiredAcceptances.length },
    })
    return { status: 'pending' }
  }
  await prisma.afLeagueTrade.update({
    where: { id: trade.id },
    data: { metadata: { ...metadata, participantRosterIds, acceptedRosterIds: [...accepted], multiTeam: participantRosterIds.length > 2 } as Prisma.InputJsonValue },
  })

  const league = await prisma.league.findUnique({ where: { id: input.leagueId } })
  if (!league) throw new Error('League not found')

  const rosterTxGateAccept = await assertRosterTransactionsAllowed({
    leagueId: input.leagueId,
    league,
    rosterIds: participantRosterIds,
    userId: input.userId,
    kind: 'trade',
  })
  if (!rosterTxGateAccept.ok) throw new Error(rosterTxGateAccept.error)

  const life = await assertLifecycleActionAllowed(input.leagueId, 'trade_act', input.userId, {
    isElevatedCommissioner: await isElevatedCommissioner(input.leagueId, input.userId),
  })
  if (!life.ok) throw new Error(life.err.error)

  const settings = resolveLeagueTradeSettings(league)
  const reviewType = trade.reviewType

  if (reviewType === 'instant') {
    await finalizeAfLeagueTradeProcessing({ tradeId: trade.id, actorUserId: input.userId })
    await notifyProposerOfDecision({
      leagueId: input.leagueId,
      tradeId: trade.id,
      proposerUserId: trade.proposedByUserId,
      type: 'trade_accepted',
      title: 'Your trade offer was accepted',
    })
    return { status: 'processed' }
  }

  if (reviewType === 'commissioner') {
    await prisma.afLeagueTrade.update({
      where: { id: trade.id },
      data: { status: 'awaiting_commissioner', acceptedAt: new Date() },
    })
    await appendAfTradeStatusHistory({
      tradeId: trade.id,
      fromStatus: 'pending',
      toStatus: 'awaiting_commissioner',
      actorUserId: input.userId,
    })
    await fanout(input.leagueId, {
      eventType: 'af_trade_awaiting_commissioner',
      title: 'Trade awaiting commissioner',
      message: 'A trade is waiting for commissioner review.',
      actorUserId: input.userId,
      meta: { tradeId: trade.id },
      dedupeKey: `af_trade:${trade.id}:awaiting_comm`,
    })
    await notifyProposerOfDecision({
      leagueId: input.leagueId,
      tradeId: trade.id,
      proposerUserId: trade.proposedByUserId,
      type: 'trade_accepted',
      title: 'Your trade offer was accepted',
      body: 'It now goes to commissioner review before processing.',
    })
    return { status: 'awaiting_commissioner' }
  }

  if (reviewType === 'league_vote') {
    await prisma.afLeagueTrade.update({
      where: { id: trade.id },
      data: { status: 'awaiting_votes', acceptedAt: new Date() },
    })
    await appendAfTradeStatusHistory({
      tradeId: trade.id,
      fromStatus: 'pending',
      toStatus: 'awaiting_votes',
      actorUserId: input.userId,
    })
    await fanout(input.leagueId, {
      eventType: 'af_trade_veto_window',
      title: 'Trade in veto window',
      message: 'League members may cast a veto vote.',
      actorUserId: input.userId,
      meta: { tradeId: trade.id },
      dedupeKey: `af_trade:${trade.id}:votes`,
    })
    await notifyProposerOfDecision({
      leagueId: input.leagueId,
      tradeId: trade.id,
      proposerUserId: trade.proposedByUserId,
      type: 'trade_accepted',
      title: 'Your trade offer was accepted',
      body: 'It now enters the league veto window before processing.',
    })
    return { status: 'awaiting_votes' }
  }

  await finalizeAfLeagueTradeProcessing({ tradeId: trade.id, actorUserId: input.userId })
  await notifyProposerOfDecision({
    leagueId: input.leagueId,
    tradeId: trade.id,
    proposerUserId: trade.proposedByUserId,
    type: 'trade_accepted',
    title: 'Your trade offer was accepted',
  })
  return { status: 'processed' }
}

export async function finalizeAfLeagueTradeProcessing(input: { tradeId: string; actorUserId: string }): Promise<void> {
  const trade = await prisma.afLeagueTrade.findUniqueOrThrow({
    where: { id: input.tradeId },
    include: { items: true },
  })
  if (trade.status === 'processed') return

  const participantRosterIds = [...new Set([
    trade.proposerRosterId,
    trade.receiverRosterId,
    ...trade.items.flatMap((item) => [item.fromRosterId, item.toRosterId]),
  ])]

  const processable = new Set(['pending', 'awaiting_commissioner', 'awaiting_votes', 'scheduled'])
  if (!processable.has(trade.status)) {
    throw new Error('Trade cannot be processed in this state')
  }
  if (trade.status === 'awaiting_votes') {
    const ok = await isElevatedCommissioner(trade.leagueId, input.actorUserId)
    if (!ok) throw new Error('Commissioner must finalize trades after the veto window')
  }

  const league = await prisma.league.findUniqueOrThrow({ where: { id: trade.leagueId } })
  const rosterTxGateFinalize = await assertRosterTransactionsAllowed({
    leagueId: trade.leagueId,
    league,
    rosterIds: participantRosterIds,
    userId: input.actorUserId,
    kind: 'trade',
  })
  if (!rosterTxGateFinalize.ok) throw new Error(rosterTxGateFinalize.error)

  const settings = resolveLeagueTradeSettings(league)
  const delayH = settings.processingDelayHours ?? trade.processingDelayHours ?? 0

  if (trade.status === 'scheduled' && trade.scheduledProcessAt && trade.scheduledProcessAt > new Date()) {
    throw new Error('Trade is scheduled for a future processing time')
  }

  if (delayH > 0 && !trade.scheduledProcessAt && trade.status !== 'scheduled') {
    const when = new Date(Date.now() + delayH * 3600 * 1000)
    await prisma.afLeagueTrade.update({
      where: { id: trade.id },
      data: { status: 'scheduled', scheduledProcessAt: when },
    })
    await appendAfTradeStatusHistory({
      tradeId: trade.id,
      fromStatus: trade.status,
      toStatus: 'scheduled',
      actorUserId: input.actorUserId,
      reason: 'delayed_processing',
    })
    await appendAfTradeProcessingEvent({
      tradeId: trade.id,
      eventType: 'trade_scheduled',
      payload: { processAt: when.toISOString() },
    })
    return
  }

  const assets: TradeAssetInput[] = trade.items.map((i) => ({
    itemType: i.itemType as TradeAssetInput['itemType'],
    itemReference: i.itemReference,
    fromRosterId: i.fromRosterId,
    toRosterId: i.toRosterId,
    faabAmount: i.faabAmount,
    metadata: (i.metadata as Record<string, unknown>) ?? {},
  }))

  await prisma.$transaction(async (tx) => {
    // 🛑 CLAIM FIRST, AND CONDITIONALLY. This was a bare `update({ where: { id } })` sitting
    // AFTER the asset move, so it processed unconditionally: two concurrent finalizers each read
    // a processable trade, each applied the assets, and each wrote `processed`. Assets applied
    // twice, one row to show for it.
    //
    // That needed two humans acting at once until `processDueScheduledTrades` started sweeping
    // due trades automatically — a cron running beside a manager pressing "process" makes it
    // routine rather than exotic, so the guard lands with the sweep that creates the exposure.
    //
    // Claiming on the status we READ, before any asset moves, means the loser throws here and
    // never touches a roster; the transaction rolls back whatever it had done.
    const claimed = await tx.afLeagueTrade.updateMany({
      where: { id: trade.id, status: trade.status },
      data: { status: 'processed', processedAt: new Date() },
    })
    if (claimed.count === 0) {
      throw new Error('TRADE_ALREADY_PROCESSED')
    }
    // ⚠ BEFORE-STATE IS READ HERE AND NOWHERE LATER. `applyTradeAssetsInTransaction` overwrites
    // `playerData` and `faabRemaining` on both rosters, so inside this transaction these rows stop
    // being "before" the moment it runs. After the claim, so only the race winner captures.
    const beforeState = await captureGenericRosterState(tx, participantRosterIds)
    await applyTradeAssetsInTransaction(tx, {
      leagueId: trade.leagueId,
      proposerRosterId: trade.proposerRosterId,
      receiverRosterId: trade.receiverRosterId,
      participantRosterIds,
      assets,
      tradeId: trade.id,
    })

    // IMMUTABLE EVIDENCE FOR THE GENERIC PATH. The native redraft route got this first; this side
    // was left explicitly uncovered, with `TradeExecutionSnapshot.genericTradeId` and its relation
    // sitting unused, so half of all executed trades still left a reversal nothing to restore to.
    await writeGenericTradeExecutionSnapshot(tx, {
      tradeId: trade.id,
      leagueId: trade.leagueId,
      proposerRosterId: trade.proposerRosterId,
      receiverRosterId: trade.receiverRosterId,
      executedByActorId: input.actorUserId,
      // From the status that was READ — the same value the claim above is conditional on.
      executedByActorRole: genericTradeActorRole(trade.status),
      governance: {
        statusWhenFinalized: trade.status,
        reviewType: trade.reviewType ?? null,
        vetoThresholdPercent: trade.vetoThresholdPercent ?? null,
        processingDelayHours: delayH,
        scheduledProcessAt: trade.scheduledProcessAt?.toISOString() ?? null,
      },
      validations: { rosterTransactionGate: 'ok' },
      assetSummary: { items: assets.length, assets },
      beforeState,
      afterState: await captureGenericRosterState(tx, participantRosterIds),
      executedAt: new Date(),
    })
    await appendAfTradeStatusHistory({
      tradeId: trade.id,
      fromStatus: trade.status,
      toStatus: 'processed',
      actorUserId: input.actorUserId,
      reason: 'processed',
    })
    await appendAfTradeProcessingEvent({ tradeId: trade.id, eventType: 'trade_processed', payload: {} })
    await logAfTradeAudit({
      leagueId: trade.leagueId,
      userId: input.actorUserId,
      actionType: 'af_trade_processed',
      tradeId: trade.id,
      afterState: { status: 'processed' },
    })
  })

  // Trade Learning Phase 8 live capture — outside the transaction per the
  // ADR's behavior-preservation strategy (a capture failure must never roll
  // back an already-successful trade). Fails safe, never throws.
  await captureLiveTradeOutcome({ tradeId: trade.id, leagueId: trade.leagueId, status: 'processed' })

  recordProductEvent(ENGAGEMENT.TRADE_PROCESSED, {
    userId: input.actorUserId,
    meta: { leagueId: trade.leagueId, tradeId: trade.id, itemCount: trade.items.length },
  })

  await fanout(trade.leagueId, {
    eventType: 'af_trade_processed',
    title: 'Trade processed',
    message: 'A trade has been processed; rosters updated.',
    actorUserId: input.actorUserId,
    meta: { tradeId: trade.id },
    dedupeKey: `af_trade:${trade.id}:processed`,
  })
}

export async function commissionerAfTradeDecision(input: {
  tradeId: string
  leagueId: string
  userId: string
  decision: 'approve' | 'reject'
}): Promise<void> {
  const elevated = await isElevatedCommissioner(input.leagueId, input.userId)
  if (!elevated) throw new Error('Commissioner only')

  const trade = await prisma.afLeagueTrade.findFirst({
    where: { id: input.tradeId, leagueId: input.leagueId },
  })
  if (!trade) throw new Error('Trade not found')
  if (trade.status !== 'awaiting_commissioner') throw new Error('Trade is not awaiting commissioner')

  if (input.decision === 'reject') {
    await prisma.afLeagueTrade.update({
      where: { id: trade.id },
      data: { status: 'rejected', rejectedAt: new Date() },
    })
    await appendAfTradeStatusHistory({
      tradeId: trade.id,
      fromStatus: trade.status,
      toStatus: 'rejected',
      actorUserId: input.userId,
      reason: 'commissioner_reject',
    })
    await captureLiveTradeOutcome({ tradeId: trade.id, leagueId: input.leagueId, status: 'rejected' })
    await notifyProposerOfDecision({
      leagueId: input.leagueId,
      tradeId: trade.id,
      proposerUserId: trade.proposedByUserId,
      type: 'trade_rejected',
      title: 'Your trade offer was rejected',
      body: 'The commissioner rejected this trade.',
    })
    return
  }

  await finalizeAfLeagueTradeProcessing({ tradeId: trade.id, actorUserId: input.userId })
}

export async function rejectAfLeagueTrade(input: { tradeId: string; leagueId: string; userId: string }): Promise<void> {
  const trade = await prisma.afLeagueTrade.findFirst({
    where: { id: input.tradeId, leagueId: input.leagueId },
  })
  if (!trade) throw new Error('Trade not found')
  if (trade.status !== 'pending') throw new Error('Trade is not pending')

  const tradeWithItems = await prisma.afLeagueTrade.findFirst({
    where: { id: input.tradeId, leagueId: input.leagueId }, include: { items: true },
  })
  const participantIds = [...new Set([
    trade.proposerRosterId,
    trade.receiverRosterId,
    ...(tradeWithItems?.items ?? []).flatMap((i) => [i.fromRosterId, i.toRosterId]),
  ])]
  let isRecv = Boolean(await prisma.roster.findFirst({
    where: { id: { in: participantIds.filter((id) => id !== trade.proposerRosterId) }, platformUserId: input.userId },
  }))
  if (!isRecv) {
    const rejectingIdentityIds = await managedPlatformIds(input.leagueId, input.userId)
    const receivingRosters = await prisma.roster.findMany({
      where: { id: { in: participantIds.filter((id) => id !== trade.proposerRosterId) }, leagueId: input.leagueId },
    })
    isRecv = receivingRosters.some((roster) => rejectingIdentityIds.has(roster.platformUserId))
  }
  const league = await prisma.league.findUnique({ where: { id: input.leagueId } })
  const isComm = league?.userId === input.userId
  if (!isRecv && !isComm) throw new Error('Only the receiving manager or commissioner can reject')

  await prisma.afLeagueTrade.update({
    where: { id: trade.id },
    data: { status: 'rejected', rejectedAt: new Date() },
  })
  await appendAfTradeStatusHistory({
    tradeId: trade.id,
    fromStatus: trade.status,
    toStatus: 'rejected',
    actorUserId: input.userId,
    reason: 'rejected',
  })
  await captureLiveTradeOutcome({ tradeId: trade.id, leagueId: input.leagueId, status: 'rejected' })
  await notifyProposerOfDecision({
    leagueId: input.leagueId,
    tradeId: trade.id,
    proposerUserId: trade.proposedByUserId,
    type: 'trade_rejected',
    title: 'Your trade offer was rejected',
  })
}

export async function cancelAfLeagueTrade(input: { tradeId: string; leagueId: string; userId: string }): Promise<void> {
  const trade = await prisma.afLeagueTrade.findFirst({
    where: { id: input.tradeId, leagueId: input.leagueId },
  })
  if (!trade) throw new Error('Trade not found')
  if (!['pending', 'scheduled'].includes(trade.status)) throw new Error('Cannot cancel')

  const isProp = await prisma.roster.findFirst({
    where: { id: trade.proposerRosterId, platformUserId: input.userId },
  })
  const elevated = await isElevatedCommissioner(input.leagueId, input.userId)
  if (!isProp && !elevated) throw new Error('Only proposer or commissioner can cancel')

  /*
   * 🛑 THE PROPOSER COULD WITHDRAW A TRADE THE OTHER MANAGER HAD ALREADY ACCEPTED. `scheduled` is set only
   * by `finalizeAfLeagueTradeProcessing` when a processing delay applies: the trade was accepted (and
   * approved, where review applies) and is waiting out the delay. Only a PENDING offer is still the
   * proposer's to withdraw.
   *
   * A commissioner may still stop a scheduled trade before it processes — but only one who is not the
   * proposer. A commissioner who proposed the trade is a party to it, and gets the proposer's rule.
   */
  if (trade.status === 'scheduled' && (isProp || !elevated)) {
    throw new Error('This trade was accepted and is scheduled to process; only a commissioner can cancel it')
  }

  /*
   * ⚠ CLAIM ON THE STATUS WE READ. This was a bare `update({ where: { id } })`, so a cancel that read
   * `scheduled` and wrote a moment after the scheduled processor claimed the trade overwrote `processed`
   * with `cancelled` — after the rosters had moved. Settlement claims the same way; the loser throws.
   */
  const claimed = await prisma.afLeagueTrade.updateMany({
    where: { id: trade.id, status: trade.status },
    data: { status: 'cancelled', cancelledAt: new Date() },
  })
  if (claimed.count === 0) throw new Error('Trade changed state before it could be cancelled')
  await appendAfTradeStatusHistory({
    tradeId: trade.id,
    fromStatus: trade.status,
    toStatus: 'cancelled',
    actorUserId: input.userId,
  })
  await captureLiveTradeOutcome({ tradeId: trade.id, leagueId: input.leagueId, status: 'cancelled' })
}

export async function castAfTradeVetoVote(input: {
  tradeId: string
  leagueId: string
  userId: string
  voterRosterId: string
  vote: 'veto' | 'allow'
}): Promise<void> {
  const trade = await prisma.afLeagueTrade.findFirst({
    where: { id: input.tradeId, leagueId: input.leagueId },
    include: { items: true },
  })
  if (!trade) throw new Error('Trade not found')
  if (trade.status !== 'awaiting_votes') throw new Error('Trade is not in veto window')

  const vr = await prisma.roster.findFirst({
    where: { id: input.voterRosterId, leagueId: input.leagueId, platformUserId: input.userId },
  })
  if (!vr) throw new Error('Invalid voter roster')
  const tradeMetadata = trade.metadata && typeof trade.metadata === 'object' && !Array.isArray(trade.metadata)
    ? trade.metadata as Record<string, unknown>
    : {}
  const recordedParticipants = Array.isArray(tradeMetadata.participantRosterIds)
    ? tradeMetadata.participantRosterIds.map(String)
    : []
  const tradingParties = new Set([trade.proposerRosterId, trade.receiverRosterId, ...recordedParticipants])
  if (tradingParties.has(vr.id)) {
    throw new Error('Trading parties cannot veto their own trade')
  }

  await prisma.afLeagueTradeVote.upsert({
    where: {
      tradeId_voterRosterId: { tradeId: trade.id, voterRosterId: input.voterRosterId },
    },
    create: {
      tradeId: trade.id,
      voterRosterId: input.voterRosterId,
      vote: input.vote === 'veto' ? 'veto' : 'allow',
    },
    update: { vote: input.vote === 'veto' ? 'veto' : 'allow' },
  })

  const allRosters = await prisma.roster.count({ where: { leagueId: input.leagueId } })
  const vetoCount = await prisma.afLeagueTradeVote.count({
    where: { tradeId: trade.id, vote: 'veto' },
  })
  const needed = Math.ceil((allRosters * (trade.vetoThresholdPercent ?? 50)) / 100)

  if (input.vote === 'veto' && vetoCount >= needed) {
    await prisma.afLeagueTrade.update({
      where: { id: trade.id },
      data: { status: 'vetoed', rejectedAt: new Date() },
    })
    await appendAfTradeStatusHistory({
      tradeId: trade.id,
      fromStatus: trade.status,
      toStatus: 'vetoed',
      actorUserId: input.userId,
      reason: 'veto_threshold',
    })
    await captureLiveTradeOutcome({ tradeId: trade.id, leagueId: input.leagueId, status: 'vetoed' })
  }
}

export async function listAfLeagueTrades(leagueId: string, opts?: { status?: string; take?: number }) {
  return prisma.afLeagueTrade.findMany({
    where: {
      leagueId,
      ...(opts?.status ? { status: opts.status } : {}),
    },
    include: { items: true, votes: true },
    orderBy: { createdAt: 'desc' },
    take: opts?.take ?? 50,
  })
}

export async function getAfLeagueTrade(leagueId: string, tradeId: string) {
  return prisma.afLeagueTrade.findFirst({
    where: { id: tradeId, leagueId },
    include: {
      items: true,
      votes: true,
      statusHistory: { orderBy: { createdAt: 'asc' }, take: 50 },
      processingEvents: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  })
}
