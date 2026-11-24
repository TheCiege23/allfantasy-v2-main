import 'server-only'
import { prisma } from '@/lib/prisma'
import { getMonetizationCatalogItemBySku, type MonetizationSku } from '@/lib/monetization/catalog'
import { upsertSubscriptionPlanForCatalogItem } from '@/lib/subscription/webhookHandlers'
import { syncUserProfileFromSubscriptions } from '@/lib/subscription/syncBridge'
import { sendNotificationEmail } from '@/lib/resend-client'
import { getStripeClient } from '@/lib/stripe-client'
import { overlapEmail, stopPaidPlansCoveredBy } from './paidPlanOverlap'
import { refreshConnectStatus, sendPayoutTransfer } from './connect'
import { loadPartnerSettings } from './service'
import { buildPayout, previousMonthKey } from './money'
import { countMeters, EMPTY_LEVEL, shouldUnlockCash, stepRewards, type FreePlan, type RewardLevels } from './meters'

/**
 * Commissioner Partner Codes — scheduled work. Both run once a day from the existing
 * /api/cron/stripe-key-health job (no cron slot of its own: the repo sits at its cron ceiling,
 * docs/crons.md). See runPartnerScheduled.
 *   daily:   active days, meters, free plans, cash unlock, scheduled → accrued
 *   monthly: last month's statements; idempotent (one per code per month), so running it daily is
 *            safe and also catches up a missed 1st. No money moves — an admin approves each one.
 */

const DAY = 86_400_000

// ---------------------------------------------------------------------------
// Free plans are real subscription rows, so every existing entitlement check sees them.
// ---------------------------------------------------------------------------

const FREE_PLAN_SKU: Record<Exclude<FreePlan, 'none'>, MonetizationSku> = {
  commissioner: 'af_commissioner_monthly',
  supreme: 'af_supreme_monthly',
}

function rewardRowId(partnerCodeId: string): string {
  return `partner-reward-${partnerCodeId}`
}

/**
 * Grant or remove the commissioner's free plan. One row per code, renewed each
 * day with a 3-day period so it lapses by itself if the job ever stops — a free
 * plan must never outlive the program silently.
 */
export async function applyFreePlan(partnerCodeId: string, ownerUserId: string, plan: FreePlan, now = new Date()) {
  const id = rewardRowId(partnerCodeId)
  if (plan === 'none') {
    const res = await prisma.userSubscription.updateMany({
      where: { id, status: 'active' },
      data: { status: 'canceled', canceledAt: now, expiresAt: now },
    })
    if (res.count) await syncUserProfileFromSubscriptions(ownerUserId)
    return
  }
  const item = getMonetizationCatalogItemBySku(FREE_PLAN_SKU[plan])
  if (!item) return
  const planRow = await upsertSubscriptionPlanForCatalogItem(item)
  if (!planRow) return
  const data = {
    userId: ownerUserId,
    subscriptionPlanId: planRow.id,
    status: 'active',
    source: 'partner_reward',
    sku: item.sku,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 3 * DAY),
    canceledAt: null,
    expiresAt: null,
    metadata: { partnerCodeId, freePlan: plan },
  }
  await prisma.userSubscription.upsert({ where: { id }, create: { id, ...data }, update: data })
  await syncUserProfileFromSubscriptions(ownerUserId)
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

export async function runPartnerDaily(now = new Date()) {
  const s = await loadPartnerSettings()
  const windowStart = new Date(now.getTime() - s.activeWindowDays * DAY)
  const clearCutoff = new Date(now.getTime() - s.paymentClearDays * DAY)
  let codes = 0
  let cashUnlocked = 0

  // Yearly slices whose month has come.
  const accrued = await prisma.partnerCommissionEntry.updateMany({
    where: { status: 'scheduled', earnedAt: { lte: now } },
    data: { status: 'accrued' },
  })

  // Subscribers whose first payment has cleared become "qualified".
  await prisma.partnerReferral.updateMany({
    where: { status: 'pending', currentlyPaying: true, firstPaidAt: { lte: clearCutoff } },
    data: { status: 'qualified', qualifiedAt: now },
  })

  const active = await prisma.partnerCode.findMany({ where: { status: 'active', isDemo: false }, select: { id: true, ownerUserId: true, cashUnlockedAt: true, rewardLevels: true, freePlan: true } })
  for (const code of active) {
    codes++
    const activity = await prisma.partnerReferralActivity.groupBy({
      by: ['referralId'],
      where: { day: { gte: windowStart }, referral: { partnerCodeId: code.id } },
      _count: { _all: true },
    })
    const daysBy = new Map(activity.map((a) => [a.referralId, a._count._all]))
    const referrals = await prisma.partnerReferral.findMany({
      where: { partnerCodeId: code.id },
      select: { id: true, status: true, firstPaidAt: true, currentlyPaying: true, activeDaysInWindow: true },
    })
    for (const r of referrals) {
      const d = daysBy.get(r.id) ?? 0
      if (d !== r.activeDaysInWindow) await prisma.partnerReferral.update({ where: { id: r.id }, data: { activeDaysInWindow: d } })
      r.activeDaysInWindow = d
    }
    const meters = countMeters(
      referrals.map((r) => ({ status: r.status as never, firstPaidAt: r.firstPaidAt, currentlyPaying: r.currentlyPaying, activeDaysInWindow: r.activeDaysInWindow })),
      now,
      s,
    )
    const prev = (code.rewardLevels as RewardLevels | null) ?? { commissionerActive: EMPTY_LEVEL, supremeActive: EMPTY_LEVEL, supremePaid: EMPTY_LEVEL }
    const revived = reviveLevels(prev)
    const { levels, freePlan } = stepRewards(revived, meters, now, s)
    const unlock = shouldUnlockCash(code.cashUnlockedAt, meters.paidSubs, s)
    if (unlock) cashUnlocked++
    await prisma.partnerCode.update({
      where: { id: code.id },
      data: {
        paidSubsCount: meters.paidSubs,
        activeUsersCount: meters.activeUsers,
        pendingPaidCount: meters.pendingPaid,
        metersUpdatedAt: now,
        rewardLevels: levels as unknown as object,
        freePlan,
        ...(unlock ? { cashUnlockedAt: now } : {}),
      },
    })
    await applyFreePlan(code.id, code.ownerUserId, freePlan, now)
    if (freePlan !== 'none') await stopOverlappingPaidPlan(code.id, code.ownerUserId, freePlan, code.freePlan)
  }
  const payoutsReleased = await releasePayoutsHeldForSetup().catch((error) => {
    console.warn('[partner-codes] payout release failed', (error as Error)?.message)
    return 0
  })
  return { codes, cashUnlocked, slicesAccrued: accrued.count, payoutsReleased }
}

/**
 * Commissioners who finished Stripe payout setup since their statement was held: re-check their
 * account (the capability can take a while to turn active) and put the statement back in review.
 */
async function releasePayoutsHeldForSetup(): Promise<number> {
  const held = await prisma.partnerPayout.findMany({ where: { status: 'held', isDemo: false, heldReason: { startsWith: 'Waiting for payout setup' } }, select: { id: true, ownerUserId: true } })
  if (!held.length) return 0
  const stripe = getStripeClient()
  const checked = new Map<string, string>()
  let released = 0
  for (const h of held) {
    if (!checked.has(h.ownerUserId)) checked.set(h.ownerUserId, await refreshConnectStatus(stripe, h.ownerUserId).catch(() => 'none'))
    if (checked.get(h.ownerUserId) !== 'active') continue
    await prisma.partnerPayout.update({ where: { id: h.id }, data: { status: 'pending_review', heldReason: null } })
    released++
  }
  return released
}

/**
 * Owner's rule: a commissioner on a free plan is not also charged for a paid plan it covers
 * (lib/partner-codes/paidPlanOverlap.ts). Stripe renewals are turned off; store-billed plans get an
 * email saying how to cancel, sent only on the day the free plan first unlocks so it is not daily.
 * Never throws into the job.
 */
async function stopOverlappingPaidPlan(partnerCodeId: string, ownerUserId: string, freePlan: Exclude<FreePlan, 'none'>, previousPlan: string) {
  try {
    const result = await stopPaidPlansCoveredBy({ stripe: getStripeClient(), userId: ownerUserId, freePlan, partnerCodeId })
    const email = overlapEmail(freePlan, { stopped: result.stopped, storeOwned: freePlan !== previousPlan ? result.storeOwned : [] })
    if (!email) return
    const user = await prisma.appUser.findUnique({ where: { id: ownerUserId }, select: { email: true } })
    if (user?.email) await sendNotificationEmail({ to: user.email, ...email, actionHref: '/partner-code', actionLabel: 'See your Partner Code' })
  } catch (error) {
    console.warn('[partner-codes] paid-plan overlap not handled', { partnerCodeId, message: (error as Error)?.message })
  }
}

/** Dates come back from JSON as strings. */
function reviveLevels(raw: RewardLevels): RewardLevels {
  const fix = (l: { aboveSince: unknown; belowSince: unknown; granted: boolean } | undefined) => ({
    aboveSince: l?.aboveSince ? new Date(l.aboveSince as string) : null,
    belowSince: l?.belowSince ? new Date(l.belowSince as string) : null,
    granted: !!l?.granted,
  })
  return { commissionerActive: fix(raw.commissionerActive), supremeActive: fix(raw.supremeActive), supremePaid: fix(raw.supremePaid) }
}

// ---------------------------------------------------------------------------
// Monthly
// ---------------------------------------------------------------------------

export async function runPartnerMonthly(now = new Date()) {
  const s = await loadPartnerSettings()
  const periodMonth = previousMonthKey(now)
  const cutoff = new Date(now.getTime() - s.paymentClearDays * DAY)
  const codes = await prisma.partnerCode.findMany({ where: { isDemo: false }, select: { id: true, ownerUserId: true, code: true } })
  const summary = { created: 0, held: 0, rolledOver: 0, alreadyBuilt: 0 }

  for (const code of codes) {
    const existing = await prisma.partnerPayout.findUnique({ where: { partnerCodeId_periodMonth: { partnerCodeId: code.id, periodMonth } } })
    if (existing) { summary.alreadyBuilt++; continue }
    const entries = await prisma.partnerCommissionEntry.findMany({
      where: {
        partnerCodeId: code.id,
        payoutId: null,
        status: { in: ['accrued', 'clawback'] },
        earnedAt: { lte: cutoff },
        // Flagged subscribers earn nothing until an admin clears them.
        OR: [{ referralId: null }, { referral: { status: { notIn: ['flagged', 'rejected'] } } }],
      },
      select: { id: true, commissionMillicents: true },
    })
    const tax = await prisma.partnerTaxProfile.findUnique({ where: { ownerUserId: code.ownerUserId } })
    const decision = buildPayout({
      entriesMillicents: entries.map((e) => e.commissionMillicents),
      hasTaxForm: tax?.w9Status === 'submitted' || tax?.w9Status === 'verified',
      settings: s,
    })
    if (decision.kind === 'none') { if (decision.reason !== 'empty') summary.rolledOver++; continue }

    await prisma.$transaction(async (tx) => {
      const payout = await tx.partnerPayout.create({
        data: {
          partnerCodeId: code.id,
          ownerUserId: code.ownerUserId,
          periodMonth,
          totalCents: decision.totalCents,
          status: decision.status,
          heldReason: decision.heldReason,
        },
      })
      await tx.partnerCommissionEntry.updateMany({ where: { id: { in: entries.map((e) => e.id) } }, data: { payoutId: payout.id } })
    })
    summary.created++
    if (decision.status === 'held') summary.held++
    await emailStatement(code.ownerUserId, periodMonth, decision.totalCents, decision.status === 'held').catch((error) =>
      console.warn('[partner-codes] statement email failed', (error as Error)?.message),
    )
  }
  const autoSent = await autoSendSmallPayouts(s.autoSendMaxCents)
  return { periodMonth, ...summary, autoSent }
}

/**
 * The optional "send without approval" setting: pending statements up to `maxCents` whose
 * commissioner's payout account is active go straight out. Never for a statement that touches a
 * flagged or rejected subscriber. 0 = off.
 */
export async function autoSendSmallPayouts(maxCents: number): Promise<number> {
  if (maxCents <= 0) return 0
  const candidates = await prisma.partnerPayout.findMany({
    where: { status: 'pending_review', isDemo: false, totalCents: { lte: maxCents }, transferError: null },
    select: { id: true },
  })
  let sent = 0
  for (const c of candidates) {
    const flagged = await prisma.partnerCommissionEntry.count({ where: { payoutId: c.id, referral: { status: { in: ['flagged', 'rejected'] } } } })
    if (flagged) continue
    const r = await payPayout(c.id, 'auto').catch(() => null)
    if (r?.status === 'paid') sent++
  }
  return sent
}

async function emailStatement(userId: string, periodMonth: string, totalCents: number, held: boolean) {
  const user = await prisma.appUser.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user?.email) return
  const amount = `$${(totalCents / 100).toFixed(2)}`
  await sendNotificationEmail({
    to: user.email,
    subject: `Your ${periodMonth} Partner Code statement: ${amount}`,
    bodyHtml: held
      ? `<p>You earned <strong>${amount}</strong> in ${periodMonth}. Set up payouts (your bank and tax info, through Stripe) and we'll send it.</p>`
      : `<p>You earned <strong>${amount}</strong> in ${periodMonth}. It's in review and goes to your bank around the 15th.</p>`,
    actionHref: '/partner-code',
    actionLabel: held ? 'Set up payouts' : 'See your statement',
  })
}

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

/**
 * Send an approved (or auto-approved) statement to the commissioner's Stripe payout account and
 * record the result. A failed transfer leaves it `approved` with `transferError` set, so an admin
 * can retry; the transfer's idempotency key is the payout id, so a retry can never pay twice.
 */
export async function payPayout(payoutId: string, by: 'admin' | 'auto', adminUserId: string | null = null) {
  const p = await prisma.partnerPayout.findUnique({ where: { id: payoutId } })
  if (!p) throw new Error('Payout not found')
  if (p.status === 'paid') return p
  if (p.status === 'held') throw new Error('Release the hold first')
  const now = new Date()
  const result = await sendPayoutTransfer(getStripeClient(), p)
  if (!result.ok) {
    return prisma.partnerPayout.update({
      where: { id: p.id },
      data: {
        status: 'approved', approvedAt: p.approvedAt ?? now, approvedBy: p.approvedBy ?? (by === 'auto' ? 'auto' : adminUserId), transferError: result.message,
        // A definite refusal frees the next retry to use a fresh idempotency key (see createPayoutTransfer).
        ...(result.definite ? { transferAttempts: { increment: 1 } } : {}),
      },
    })
  }
  const paid = await prisma.$transaction(async (tx) => {
    await tx.partnerCommissionEntry.updateMany({ where: { payoutId: p.id, status: 'accrued' }, data: { status: 'paid' } })
    return tx.partnerPayout.update({
      where: { id: p.id },
      data: {
        status: 'paid', paidAt: now, method: 'stripe_connect', externalRef: result.transferId, transferError: null,
        approvedAt: p.approvedAt ?? now, approvedBy: p.approvedBy ?? (by === 'auto' ? 'auto' : adminUserId),
      },
    })
  })
  await emailPaid(p.ownerUserId, p.periodMonth, p.totalCents).catch(() => null)
  return paid
}

async function emailPaid(userId: string, periodMonth: string, totalCents: number) {
  const user = await prisma.appUser.findUnique({ where: { id: userId }, select: { email: true } })
  if (!user?.email) return
  const amount = `$${(totalCents / 100).toFixed(2)}`
  await sendNotificationEmail({
    to: user.email,
    subject: `${amount} is on its way to your bank`,
    bodyHtml: `<p>We sent your ${periodMonth} Partner Code commission of <strong>${amount}</strong>. It usually reaches your bank in about 2 business days.</p>`,
    actionHref: '/partner-code',
    actionLabel: 'See your statements',
  })
}

export async function setPayoutStatus(payoutId: string, action: 'approve' | 'hold' | 'mark_paid' | 'send', adminUserId: string | null, note?: string) {
  const now = new Date()
  const p = await prisma.partnerPayout.findUnique({ where: { id: payoutId } })
  if (!p) throw new Error('Payout not found')
  if (action === 'approve' || action === 'send') {
    if (p.status === 'paid') throw new Error('Already paid')
    const tax = await prisma.partnerTaxProfile.findUnique({ where: { ownerUserId: p.ownerUserId } })
    if (!(tax?.w9Status === 'submitted' || tax?.w9Status === 'verified')) throw new Error('No payout setup or W-9 on file')
    const approved = await prisma.partnerPayout.update({ where: { id: p.id }, data: { status: 'approved', heldReason: null, approvedAt: now, approvedBy: adminUserId } })
    // On Stripe Connect, approving IS sending. Without it, it waits for a manual "Mark paid".
    if (tax?.stripeAccountId) return payPayout(p.id, 'admin', adminUserId)
    return approved
  }
  if (action === 'hold') {
    if (p.status === 'paid') throw new Error('Already paid')
    return prisma.partnerPayout.update({ where: { id: p.id }, data: { status: 'held', heldReason: note?.trim() || 'Held by admin' } })
  }
  if (p.status !== 'approved') throw new Error('Approve it first')
  return prisma.$transaction(async (tx) => {
    await tx.partnerCommissionEntry.updateMany({ where: { payoutId: p.id, status: 'accrued' }, data: { status: 'paid' } })
    return tx.partnerPayout.update({ where: { id: p.id }, data: { status: 'paid', paidAt: now, method: 'manual', externalRef: note?.trim() || null } })
  })
}

/** Clear a flagged referral (it starts counting) or reject it (its commission is reversed). */
export async function reviewReferral(referralId: string, action: 'clear' | 'reject') {
  const r = await prisma.partnerReferral.findUnique({ where: { id: referralId } })
  if (!r) throw new Error('Referral not found')
  if (action === 'clear') {
    return prisma.partnerReferral.update({ where: { id: r.id }, data: { status: r.currentlyPaying ? 'pending' : 'churned', flagReasons: [] } })
  }
  const unpaid = await prisma.partnerCommissionEntry.findMany({ where: { referralId: r.id, payoutId: null, status: { in: ['scheduled', 'accrued'] } }, select: { id: true } })
  const paid = await prisma.partnerCommissionEntry.aggregate({ where: { referralId: r.id, status: 'paid' }, _sum: { commissionMillicents: true } })
  const paidSum = paid._sum.commissionMillicents ?? 0
  return prisma.$transaction([
    prisma.partnerCommissionEntry.updateMany({ where: { id: { in: unpaid.map((e) => e.id) } }, data: { status: 'reversed' } }),
    ...(paidSum > 0
      ? [prisma.partnerCommissionEntry.upsert({
          where: { source_sourceRef_installment: { source: 'adjustment', sourceRef: `reject:${r.id}`, installment: 0 } },
          create: { partnerCodeId: r.partnerCodeId, referralId: r.id, source: 'adjustment', sourceRef: `reject:${r.id}`, periodMonth: new Date().toISOString().slice(0, 7), earnedAt: new Date(), commissionMillicents: -paidSum, status: 'clawback' },
          update: {},
        })]
      : []),
    prisma.partnerReferral.update({ where: { id: r.id }, data: { status: 'rejected' } }),
  ])
}

/** CSV of paid payouts in a year, for 1099 prep. */
export async function payoutsCsv(year: number): Promise<string> {
  const rows = await prisma.partnerPayout.findMany({
    where: { status: 'paid', isDemo: false, periodMonth: { startsWith: `${year}-` } },
    orderBy: [{ ownerUserId: 'asc' }, { periodMonth: 'asc' }],
    include: { partnerCode: { select: { code: true } } },
  })
  const tax = await prisma.partnerTaxProfile.findMany({ where: { ownerUserId: { in: rows.map((r) => r.ownerUserId) } } })
  const taxBy = new Map(tax.map((t) => [t.ownerUserId, t]))
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [['owner_user_id', 'code', 'legal_name', 'w9_status', 'period', 'amount_usd', 'paid_at', 'reference'].join(',')]
  for (const r of rows) {
    const t = taxBy.get(r.ownerUserId)
    lines.push([r.ownerUserId, r.partnerCode.code, t?.legalName, t?.w9Status ?? 'missing', r.periodMonth, (r.totalCents / 100).toFixed(2), r.paidAt?.toISOString(), r.externalRef].map(esc).join(','))
  }
  return lines.join('\n') + '\n'
}

/**
 * Both jobs, each isolated: a failure in one is reported and never stops the other, and neither
 * can throw into the host cron. Off unless PARTNER_CODES_ENABLED=1 (checked by the caller).
 */
export async function runPartnerScheduled(now = new Date()) {
  const out: { daily: unknown; monthly: unknown; errors: string[] } = { daily: null, monthly: null, errors: [] }
  try {
    out.daily = await runPartnerDaily(now)
  } catch (error) {
    out.errors.push(`daily: ${(error as Error)?.message ?? String(error)}`)
  }
  try {
    out.monthly = await runPartnerMonthly(now)
  } catch (error) {
    out.errors.push(`monthly: ${(error as Error)?.message ?? String(error)}`)
  }
  return out
}
