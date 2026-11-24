import 'server-only'
import { prisma } from '@/lib/prisma'
import { loadPartnerSettings } from './service'
import { millicentsToCents } from './money'
import type { PartnerSettings } from './settings'

export type PartnerDashboard = {
  settings: Pick<PartnerSettings, 'discountPercent' | 'discountMonths' | 'commissionPercent' | 'cashThresholdPaidSubs' | 'freeSupremePaidSubs' | 'freeCommissionerActiveUsers' | 'freeSupremeActiveUsers' | 'rewardHoldDays' | 'minPayoutCents'>
  code: null | {
    code: string
    status: string
    isDemo: boolean
    shareLook: string
    shareLogo: string
    logoStatus: string
    logoUrl: string | null
    logoReviewNote: string | null
    joinPath: string
    paidSubs: number
    activeUsers: number
    pendingPaid: number
    freePlan: string
    cashOn: boolean
    cashUnlockedAt: string | null
    metersUpdatedAt: string | null
    signups: number
    mix: Array<{ plan: string; month: number; year: number }>
    earnings: { thisMonthCents: number; lifetimeCents: number; paidOutCents: number; pendingCents: number }
    payouts: Array<{ periodMonth: string; totalCents: number; status: string; heldReason: string | null }>
    taxFormStatus: string
    /** none | pending | restricted | unsupported | active: their Stripe payout account. */
    payoutSetup: string
  }
}

const PLAN_LABEL: Record<string, string> = {
  af_pro: 'AF Pro',
  af_commissioner: 'AF Commissioner',
  af_supreme: 'AF Supreme',
  af_war_room: 'AF Legacy',
}

export async function getPartnerDashboard(userId: string, now = new Date()): Promise<PartnerDashboard> {
  const s = await loadPartnerSettings()
  const settings = {
    discountPercent: s.discountPercent,
    discountMonths: s.discountMonths,
    commissionPercent: s.commissionPercent,
    cashThresholdPaidSubs: s.cashThresholdPaidSubs,
    freeSupremePaidSubs: s.freeSupremePaidSubs,
    freeCommissionerActiveUsers: s.freeCommissionerActiveUsers,
    freeSupremeActiveUsers: s.freeSupremeActiveUsers,
    rewardHoldDays: s.rewardHoldDays,
    minPayoutCents: s.minPayoutCents,
  }
  const code = await prisma.partnerCode.findUnique({ where: { ownerUserId: userId } })
  if (!code) return { settings, code: null }

  const thisMonth = now.toISOString().slice(0, 7)
  const [signups, mixRows, lifetime, month, payouts, paidOut, tax] = await Promise.all([
    prisma.partnerReferral.count({ where: { partnerCodeId: code.id } }),
    prisma.partnerReferral.groupBy({
      by: ['plan', 'interval'],
      where: { partnerCodeId: code.id, currentlyPaying: true, status: { notIn: ['flagged', 'rejected'] } },
      _count: { _all: true },
    }),
    prisma.partnerCommissionEntry.aggregate({ where: { partnerCodeId: code.id, status: { in: ['accrued', 'paid', 'clawback'] } }, _sum: { commissionMillicents: true } }),
    prisma.partnerCommissionEntry.aggregate({ where: { partnerCodeId: code.id, periodMonth: thisMonth, status: { in: ['accrued', 'scheduled', 'paid', 'clawback'] } }, _sum: { commissionMillicents: true } }),
    prisma.partnerPayout.findMany({ where: { partnerCodeId: code.id }, orderBy: { periodMonth: 'desc' }, take: 24 }),
    prisma.partnerPayout.aggregate({ where: { partnerCodeId: code.id, status: 'paid' }, _sum: { totalCents: true } }),
    prisma.partnerTaxProfile.findUnique({ where: { ownerUserId: userId } }),
  ])

  const mixMap = new Map<string, { plan: string; month: number; year: number }>()
  for (const r of mixRows) {
    if (!r.plan) continue
    const row = mixMap.get(r.plan) ?? { plan: PLAN_LABEL[r.plan] ?? r.plan, month: 0, year: 0 }
    if (r.interval === 'year') row.year += r._count._all
    else row.month += r._count._all
    mixMap.set(r.plan, row)
  }
  const lifetimeCents = millicentsToCents(lifetime._sum.commissionMillicents ?? 0)
  const paidOutCents = paidOut._sum.totalCents ?? 0

  return {
    settings,
    code: {
      code: code.code,
      status: code.status,
      isDemo: code.isDemo,
      shareLook: code.shareLook,
      shareLogo: code.shareLogo,
      logoStatus: code.logoStatus,
      logoUrl: code.logoUrl,
      logoReviewNote: code.logoReviewNote,
      joinPath: `/with/${encodeURIComponent(code.code)}`,
      paidSubs: code.paidSubsCount,
      activeUsers: code.activeUsersCount,
      pendingPaid: code.pendingPaidCount,
      freePlan: code.freePlan,
      cashOn: !!code.cashUnlockedAt,
      cashUnlockedAt: code.cashUnlockedAt?.toISOString() ?? null,
      metersUpdatedAt: code.metersUpdatedAt?.toISOString() ?? null,
      signups,
      mix: Array.from(mixMap.values()),
      earnings: {
        thisMonthCents: millicentsToCents(month._sum.commissionMillicents ?? 0),
        lifetimeCents,
        paidOutCents,
        pendingCents: Math.max(0, lifetimeCents - paidOutCents),
      },
      payouts: payouts.map((p) => ({ periodMonth: p.periodMonth, totalCents: p.totalCents, status: p.status, heldReason: p.heldReason })),
      taxFormStatus: tax?.w9Status ?? 'missing',
      payoutSetup: tax?.stripeAccountId ? tax.stripeTransfersStatus ?? 'pending' : 'none',
    },
  }
}
