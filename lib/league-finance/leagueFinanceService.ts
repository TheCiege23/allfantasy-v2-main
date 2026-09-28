import type { LeagueTreasuryProvider, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logAction } from '@/server/services/auditService'
import { appendFinanceAuditEvent } from '@/lib/league-finance/financeAudit'
import { extractEntryFeeUsdFromSettings } from '@/lib/league-finance/extractEntryFeeFromSettings'
import { getLeagueLifecycleState } from '@/server/services/leagueLifecycleService'
import {
  canApproveOrPayPayout,
  canCreatePayoutRequest,
  payoutLifecycleMessage,
} from '@/lib/league-finance/payoutLifecycle'

/** Prisma `TransactionClient` is structurally compatible for these calls. Cast avoids Prisma extension types blowing the checker stack (TS2321). */
function dbClient(tx?: Prisma.TransactionClient): typeof prisma {
  return (tx ?? prisma) as any
}

export async function getOrCreateLeagueFinance(leagueId: string, tx?: Prisma.TransactionClient) {
  const db = dbClient(tx)
  const existing = await db.leagueFinance.findUnique({ where: { leagueId } })
  if (existing) return existing

  const league = await db.league.findUnique({
    where: { id: leagueId },
    select: { id: true, settings: true },
  })
  if (!league) return null

  const entryFeeUsd = extractEntryFeeUsdFromSettings(league.settings)
  const entryFeeCents = entryFeeUsd != null ? Math.round(entryFeeUsd * 100) : 0

  return db.leagueFinance.upsert({
    where: { leagueId },
    update: {},
    create: {
      leagueId,
      isPaidLeague: entryFeeCents > 0,
      entryFeeCents,
    },
  })
}

export async function resolveSeasonForLeague(leagueId: string, tx?: Prisma.TransactionClient): Promise<number> {
  const db = dbClient(tx)
  const league = await db.league.findUnique({
    where: { id: leagueId },
    select: { season: true },
  })
  return league?.season ?? new Date().getFullYear()
}

/** Idempotent Stripe webhook handler for checkout.session.completed */
export async function persistLeagueEntryFeeFromStripeSession(session: {
  id: string
  amount_total: number | null
  metadata: Record<string, string> | null | undefined
}): Promise<void> {
  const meta = (session.metadata ?? {}) as Record<string, string | undefined>
  const leagueId = meta.leagueId?.trim()
  const userId = meta.userId?.trim()
  if (!leagueId || !userId) {
    throw new Error('league_entry_fee checkout missing leagueId or userId metadata')
  }

  const existingBySession = await prisma.leagueDues.findFirst({
    where: { stripeCheckoutSessionId: session.id },
    select: { id: true, status: true },
  })
  if (existingBySession?.status === 'paid') {
    return
  }

  const seasonRaw = meta.season?.trim()
  const season = seasonRaw ? parseInt(seasonRaw, 10) : await resolveSeasonForLeague(leagueId)
  if (!Number.isFinite(season)) {
    throw new Error('Invalid season in league_entry_fee metadata')
  }

  const amountCents = session.amount_total ?? 0
  const finance = await getOrCreateLeagueFinance(leagueId)
  if (!finance) {
    throw new Error('League not found for league_entry_fee')
  }

  await prisma.$transaction(async (tx) => {
    const prior = await tx.leagueDues.findUnique({
      where: {
        leagueId_userId_season: { leagueId, userId, season },
      },
      select: { id: true, status: true, amountPaidCents: true },
    })

    const wasPaid = prior?.status === 'paid'

    await tx.leagueDues.upsert({
      where: {
        leagueId_userId_season: { leagueId, userId, season },
      },
      create: {
        leagueId,
        userId,
        season,
        amountDueCents: finance.entryFeeCents > 0 ? finance.entryFeeCents : amountCents,
        amountPaidCents: amountCents,
        status: 'paid',
        paymentProvider: 'stripe',
        stripeCheckoutSessionId: session.id,
        paidAt: new Date(),
      },
      update: {
        amountPaidCents: amountCents,
        status: 'paid',
        paymentProvider: 'stripe',
        stripeCheckoutSessionId: session.id,
        paidAt: new Date(),
      },
    })

    if (!wasPaid) {
      await tx.leagueFinance.update({
        where: { leagueId },
        data: { treasuryBalanceCents: { increment: amountCents } },
      })
    }

    await appendFinanceAuditEvent({
      leagueId,
      actorUserId: userId,
      eventType: 'dues_paid_stripe',
      entityType: 'league_dues',
      entityId: `${leagueId}:${userId}:${season}`,
      payload: {
        stripeCheckoutSessionId: session.id,
        amountCents,
        season,
      },
    })

    await logAction({
      leagueId,
      userId,
      actionType: 'finance_dues_paid',
      entityType: 'league_dues',
      entityId: `${leagueId}:${season}`,
      afterState: { provider: 'stripe', amountCents, season },
      metadata: { source: 'stripe_webhook', sessionId: session.id },
    })
  })
}

export async function markDuesPaidManual(input: {
  leagueId: string
  targetUserId: string
  actorUserId: string
  amountCents: number
  externalReference?: string | null
  provider?: string
}): Promise<void> {
  const finance = await prisma.leagueFinance.findUnique({ where: { leagueId: input.leagueId } })
  if (!finance?.allowManualPaymentMark) {
    throw new Error('Manual payment marking is disabled for this league.')
  }

  const season = await resolveSeasonForLeague(input.leagueId)
  const amount = Math.max(0, Math.round(input.amountCents))

  await prisma.$transaction(async (tx) => {
    const prior = await tx.leagueDues.findUnique({
      where: {
        leagueId_userId_season: {
          leagueId: input.leagueId,
          userId: input.targetUserId,
          season,
        },
      },
      select: { status: true },
    })
    const wasPaid = prior?.status === 'paid'

    await tx.leagueDues.upsert({
      where: {
        leagueId_userId_season: {
          leagueId: input.leagueId,
          userId: input.targetUserId,
          season,
        },
      },
      create: {
        leagueId: input.leagueId,
        userId: input.targetUserId,
        season,
        amountDueCents: finance.entryFeeCents > 0 ? finance.entryFeeCents : amount,
        amountPaidCents: amount,
        status: 'paid',
        paymentProvider: input.provider ?? 'manual',
        externalReference: input.externalReference ?? null,
        paidAt: new Date(),
      },
      update: {
        amountPaidCents: amount,
        status: 'paid',
        paymentProvider: input.provider ?? 'manual',
        externalReference: input.externalReference ?? null,
        paidAt: new Date(),
      },
    })

    if (!wasPaid && amount > 0) {
      await tx.leagueFinance.update({
        where: { leagueId: input.leagueId },
        data: { treasuryBalanceCents: { increment: amount } },
      })
    }

    await appendFinanceAuditEvent({
      leagueId: input.leagueId,
      actorUserId: input.actorUserId,
      eventType: 'dues_manual_mark',
      entityType: 'league_dues',
      entityId: `${input.leagueId}:${input.targetUserId}:${season}`,
      payload: {
        amountCents: amount,
        externalReference: input.externalReference ?? null,
        provider: input.provider ?? 'manual',
      },
    })

    await logAction({
      leagueId: input.leagueId,
      userId: input.actorUserId,
      actionType: 'finance_dues_manual',
      entityType: 'league_dues',
      entityId: `${input.leagueId}:${season}`,
      afterState: { targetUserId: input.targetUserId, amountCents: amount },
      metadata: { source: 'commissioner_manual' },
    })
  })
}

export async function waiveDues(input: {
  leagueId: string
  targetUserId: string
  actorUserId: string
  note?: string | null
}): Promise<void> {
  const season = await resolveSeasonForLeague(input.leagueId)
  const finance = await getOrCreateLeagueFinance(input.leagueId)
  if (!finance) throw new Error('League not found')

  await prisma.$transaction(async (tx) => {
    await tx.leagueDues.upsert({
      where: {
        leagueId_userId_season: {
          leagueId: input.leagueId,
          userId: input.targetUserId,
          season,
        },
      },
      create: {
        leagueId: input.leagueId,
        userId: input.targetUserId,
        season,
        amountDueCents: finance.entryFeeCents,
        amountPaidCents: 0,
        status: 'waived',
        paymentProvider: 'commissioner',
        paidAt: null,
      },
      update: {
        status: 'waived',
        paymentProvider: 'commissioner',
      },
    })

    await appendFinanceAuditEvent({
      leagueId: input.leagueId,
      actorUserId: input.actorUserId,
      eventType: 'dues_waived',
      entityType: 'league_dues',
      entityId: `${input.leagueId}:${input.targetUserId}:${season}`,
      payload: { note: input.note ?? null },
    })

    await logAction({
      leagueId: input.leagueId,
      userId: input.actorUserId,
      actionType: 'finance_dues_waived',
      entityType: 'league_dues',
      entityId: `${input.leagueId}:${season}`,
      afterState: { targetUserId: input.targetUserId },
      metadata: { note: input.note ?? null },
    })
  })
}

export async function createPayoutRequest(input: {
  leagueId: string
  requestedByUserId: string
  amountCents: number
  recipientNote?: string | null
}): Promise<{ id: string }> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { lifecycleState: true },
  })
  if (!league) throw new Error('League not found')

  const state = getLeagueLifecycleState(league)
  if (!canCreatePayoutRequest(state)) {
    throw new Error(payoutLifecycleMessage(state) ?? 'Payout not allowed for this league phase.')
  }

  const row = await prisma.payoutRequest.create({
    data: {
      leagueId: input.leagueId,
      requestedByUserId: input.requestedByUserId,
      amountCents: Math.max(0, Math.round(input.amountCents)),
      recipientNote: input.recipientNote?.slice(0, 512) ?? null,
      status: 'pending_approval',
    },
    select: { id: true },
  })

  await appendFinanceAuditEvent({
    leagueId: input.leagueId,
    actorUserId: input.requestedByUserId,
    eventType: 'payout_requested',
    entityType: 'payout_request',
    entityId: row.id,
    payload: { amountCents: input.amountCents },
  })

  await logAction({
    leagueId: input.leagueId,
    userId: input.requestedByUserId,
    actionType: 'finance_payout_requested',
    entityType: 'payout_request',
    entityId: row.id,
    afterState: { amountCents: input.amountCents },
  })

  return row
}

export async function decidePayout(input: {
  payoutId: string
  leagueId: string
  actorUserId: string
  decision: 'approved' | 'rejected' | 'paid'
  note?: string | null
}): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: input.leagueId },
    select: { lifecycleState: true },
  })
  if (!league) throw new Error('League not found')

  const state = getLeagueLifecycleState(league)
  if (!canApproveOrPayPayout(state)) {
    throw new Error(payoutLifecycleMessage(state) ?? 'Payout approval not allowed for this phase.')
  }

  const payout = await prisma.payoutRequest.findFirst({
    where: { id: input.payoutId, leagueId: input.leagueId },
  })
  if (!payout) throw new Error('Payout request not found')
  if (payout.status === 'frozen') {
    throw new Error('Payout is frozen for review.')
  }

  const nextStatus =
    input.decision === 'approved'
      ? 'approved'
      : input.decision === 'paid'
        ? 'paid'
        : 'rejected'

  await prisma.$transaction(async (tx) => {
    await tx.payoutApproval.create({
      data: {
        payoutRequestId: payout.id,
        approverUserId: input.actorUserId,
        decision: input.decision,
        note: input.note?.slice(0, 512) ?? null,
      },
    })

    await tx.payoutRequest.update({
      where: { id: payout.id },
      data: {
        status: nextStatus,
        ...(input.decision === 'paid'
          ? { paidAt: new Date(), paidReference: input.note?.slice(0, 256) ?? null }
          : {}),
      },
    })

    if (input.decision === 'paid' && payout.amountCents > 0) {
      await tx.leagueFinance.update({
        where: { leagueId: input.leagueId },
        data: { treasuryBalanceCents: { decrement: payout.amountCents } },
      })
    }
  })

  await appendFinanceAuditEvent({
    leagueId: input.leagueId,
    actorUserId: input.actorUserId,
    eventType: `payout_${input.decision}`,
    entityType: 'payout_request',
    entityId: payout.id,
    payload: { note: input.note ?? null },
  })

  await logAction({
    leagueId: input.leagueId,
    userId: input.actorUserId,
    actionType: `finance_payout_${input.decision}`,
    entityType: 'payout_request',
    entityId: payout.id,
    afterState: { status: nextStatus },
  })
}

export async function setPayoutFrozen(input: {
  payoutId: string
  leagueId: string
  actorUserId: string
  freeze: boolean
  reason?: string | null
}): Promise<void> {
  await prisma.payoutRequest.updateMany({
    where: { id: input.payoutId, leagueId: input.leagueId },
    data: {
      status: input.freeze ? 'frozen' : 'pending_approval',
      freezeReason: input.freeze ? input.reason?.slice(0, 512) ?? 'Frozen for review' : null,
      frozenAt: input.freeze ? new Date() : null,
    },
  })

  await appendFinanceAuditEvent({
    leagueId: input.leagueId,
    actorUserId: input.actorUserId,
    eventType: input.freeze ? 'payout_frozen' : 'payout_unfrozen',
    entityType: 'payout_request',
    entityId: input.payoutId,
    payload: { reason: input.reason ?? null },
  })

  await logAction({
    leagueId: input.leagueId,
    userId: input.actorUserId,
    actionType: input.freeze ? 'finance_payout_frozen' : 'finance_payout_unfrozen',
    entityType: 'payout_request',
    entityId: input.payoutId,
    metadata: { reason: input.reason ?? null },
  })
}

export async function updateFinanceSettings(input: {
  leagueId: string
  actorUserId: string
  patch: {
    isPaidLeague?: boolean
    entryFeeCents?: number
    allowManualPaymentMark?: boolean
    treasuryProvider?: LeagueTreasuryProvider
    externalEscrowUrl?: string | null
    externalEscrowLabel?: string | null
  }
}): Promise<void> {
  await getOrCreateLeagueFinance(input.leagueId)
  const before = await prisma.leagueFinance.findUnique({ where: { leagueId: input.leagueId } })

  await prisma.leagueFinance.update({
    where: { leagueId: input.leagueId },
    data: {
      ...(input.patch.isPaidLeague !== undefined ? { isPaidLeague: input.patch.isPaidLeague } : {}),
      ...(input.patch.entryFeeCents !== undefined
        ? { entryFeeCents: Math.max(0, Math.round(input.patch.entryFeeCents)) }
        : {}),
      ...(input.patch.allowManualPaymentMark !== undefined
        ? { allowManualPaymentMark: input.patch.allowManualPaymentMark }
        : {}),
      ...(input.patch.treasuryProvider !== undefined ? { treasuryProvider: input.patch.treasuryProvider } : {}),
      ...(input.patch.externalEscrowUrl !== undefined ? { externalEscrowUrl: input.patch.externalEscrowUrl } : {}),
      ...(input.patch.externalEscrowLabel !== undefined ? { externalEscrowLabel: input.patch.externalEscrowLabel } : {}),
    },
  })

  const after = await prisma.leagueFinance.findUnique({ where: { leagueId: input.leagueId } })

  await appendFinanceAuditEvent({
    leagueId: input.leagueId,
    actorUserId: input.actorUserId,
    eventType: 'finance_settings_updated',
    entityType: 'league_finance',
    entityId: input.leagueId,
    payload: { before, after },
  })

  await logAction({
    leagueId: input.leagueId,
    userId: input.actorUserId,
    actionType: 'finance_settings_edit',
    entityType: 'league_finance',
    entityId: input.leagueId,
    beforeState: before ?? undefined,
    afterState: after ?? undefined,
  })
}
