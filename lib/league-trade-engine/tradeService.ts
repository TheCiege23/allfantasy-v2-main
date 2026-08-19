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

export async function createAfLeagueTrade(input: CreateLeagueTradeInput & { currentWeek?: number | null }): Promise<{ id: string }> {
  const league = await prisma.league.findUnique({ where: { id: input.leagueId } })
  if (!league) throw new Error('League not found')

  const life = await assertLifecycleActionAllowed(input.leagueId, 'trade_act', input.proposedByUserId, {
    isElevatedCommissioner: await isElevatedCommissioner(input.leagueId, input.proposedByUserId),
  })
  if (!life.ok) throw new Error(life.err.error)

  const [proposer, receiver] = await Promise.all([
    prisma.roster.findFirst({ where: { id: input.proposerRosterId, leagueId: input.leagueId } }),
    prisma.roster.findFirst({ where: { id: input.receiverRosterId, leagueId: input.leagueId } }),
  ])
  if (!proposer || !receiver) throw new Error('Roster not found')
  if (proposer.platformUserId !== input.proposedByUserId) {
    throw new Error('Proposer must own the proposing roster')
  }

  const rosterTxGate = await assertRosterTransactionsAllowed({
    leagueId: input.leagueId,
    league,
    rosterIds: [proposer.id, receiver.id],
    userId: input.proposedByUserId,
    kind: 'trade',
  })
  if (!rosterTxGate.ok) throw new Error(rosterTxGate.error)

  const settings = resolveLeagueTradeSettings(league)
  const v = validateTradeAssets({
    league,
    settings,
    proposer,
    receiver,
    assets: input.assets,
    currentWeek: input.currentWeek ?? null,
  })
  if (!v.ok) throw new Error(v.message)

  const expiresHours = input.expiresInHours ?? 48
  const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000)
  const reviewType = mapReviewToTradeReviewType(settings.tradeReviewMode)

  const parent = input.parentTradeId
    ? await prisma.afLeagueTrade.findFirst({
        where: { id: input.parentTradeId, leagueId: input.leagueId },
      })
    : null
  if (input.parentTradeId && !parent) throw new Error('Parent trade not found')

  const rootId = parent?.rootTradeId ?? parent?.id ?? null

  const trade = await prisma.afLeagueTrade.create({
    data: {
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
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      items: {
        create: input.assets.map((a) => ({
          itemType: a.itemType,
          itemReference: a.itemReference ?? null,
          fromRosterId: a.fromRosterId,
          toRosterId: a.toRosterId,
          faabAmount: a.faabAmount ?? null,
          metadata: (a.metadata ?? {}) as Prisma.InputJsonValue,
        })),
      },
    },
  })

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
  })

  if (input.parentTradeId && parent) {
    await prisma.afLeagueTrade.update({
      where: { id: parent.id },
      data: { status: 'countered', metadata: { ...(parent.metadata as object), counterTradeId: trade.id } as Prisma.InputJsonValue },
    })
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

  const receiver = await prisma.roster.findUnique({ where: { id: trade.receiverRosterId } })
  if (!receiver || receiver.platformUserId !== input.userId) {
    throw new Error('Only the receiving manager can accept')
  }

  const league = await prisma.league.findUnique({ where: { id: input.leagueId } })
  if (!league) throw new Error('League not found')

  const rosterTxGateAccept = await assertRosterTransactionsAllowed({
    leagueId: input.leagueId,
    league,
    rosterIds: [trade.proposerRosterId, trade.receiverRosterId],
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
    return { status: 'awaiting_votes' }
  }

  await finalizeAfLeagueTradeProcessing({ tradeId: trade.id, actorUserId: input.userId })
  return { status: 'processed' }
}

export async function finalizeAfLeagueTradeProcessing(input: { tradeId: string; actorUserId: string }): Promise<void> {
  const trade = await prisma.afLeagueTrade.findUniqueOrThrow({
    where: { id: input.tradeId },
    include: { items: true },
  })
  if (trade.status === 'processed') return

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
    rosterIds: [trade.proposerRosterId, trade.receiverRosterId],
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
    await applyTradeAssetsInTransaction(tx, {
      leagueId: trade.leagueId,
      proposerRosterId: trade.proposerRosterId,
      receiverRosterId: trade.receiverRosterId,
      assets,
    })
    await tx.afLeagueTrade.update({
      where: { id: trade.id },
      data: { status: 'processed', processedAt: new Date() },
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

  const isRecv = await prisma.roster.findFirst({
    where: { id: trade.receiverRosterId, platformUserId: input.userId },
  })
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

  await prisma.afLeagueTrade.update({
    where: { id: trade.id },
    data: { status: 'cancelled', cancelledAt: new Date() },
  })
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
  })
  if (!trade) throw new Error('Trade not found')
  if (trade.status !== 'awaiting_votes') throw new Error('Trade is not in veto window')

  const vr = await prisma.roster.findFirst({
    where: { id: input.voterRosterId, leagueId: input.leagueId, platformUserId: input.userId },
  })
  if (!vr) throw new Error('Invalid voter roster')
  if (vr.id === trade.proposerRosterId || vr.id === trade.receiverRosterId) {
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
