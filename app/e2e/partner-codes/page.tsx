import { notFound } from 'next/navigation'
import { PartnerCodeDashboard } from '@/components/partner-codes/PartnerCodeDashboard'
import { EarningsCalculator } from '@/components/partner-codes/EarningsCalculator'
import { DEFAULT_PARTNER_SETTINGS } from '@/lib/partner-codes/settings'
import type { PartnerDashboard } from '@/lib/partner-codes/dashboard'

/**
 * Harness for the Commissioner Partner Codes screens with fixed sample data — no database.
 *   /e2e/partner-codes?view=after    a code past the cash bar
 *   /e2e/partner-codes?view=before   a code still climbing
 *   /e2e/partner-codes?view=claim    no code yet
 *   /e2e/partner-codes?view=calc     the public earnings calculator
 *   /e2e/partner-codes?view=logo-pending | logo-rejected   the uploaded-logo states
 * The share-image preview draws through the harness twin of the image API (./image).
 */
const S = DEFAULT_PARTNER_SETTINGS
const settings: PartnerDashboard['settings'] = {
  discountPercent: S.discountPercent,
  discountMonths: S.discountMonths,
  commissionPercent: S.commissionPercent,
  cashThresholdPaidSubs: S.cashThresholdPaidSubs,
  freeSupremePaidSubs: S.freeSupremePaidSubs,
  freeCommissionerActiveUsers: S.freeCommissionerActiveUsers,
  freeSupremeActiveUsers: S.freeSupremeActiveUsers,
  rewardHoldDays: S.rewardHoldDays,
  minPayoutCents: S.minPayoutCents,
}

const after: PartnerDashboard = {
  settings,
  code: {
    code: 'TheCiege', status: 'active', isDemo: true, shareLook: 'midnight', shareLogo: 'upload', logoStatus: 'approved',
    logoUrl: '/e2e/partner-codes/image?sampleLogo=1', logoReviewNote: null,
    joinPath: '/with/TheCiege', paidSubs: 34, activeUsers: 61, pendingPaid: 5, freePlan: 'supreme', cashOn: true,
    cashUnlockedAt: '2026-08-14T00:00:00Z', metersUpdatedAt: '2026-11-23T09:00:00Z', signups: 88,
    mix: [{ plan: 'AF Pro', month: 15, year: 2 }, { plan: 'AF Commissioner', month: 9, year: 1 }, { plan: 'AF Supreme', month: 6, year: 1 }],
    earnings: { thisMonthCents: 3866, lifetimeCents: 12940, paidOutCents: 8212, pendingCents: 4728 },
    payouts: [
      { periodMonth: '2026-10', totalCents: 3512, status: 'pending_review', heldReason: null },
      { periodMonth: '2026-09', totalCents: 2976, status: 'paid', heldReason: null },
      { periodMonth: '2026-08', totalCents: 5236, status: 'paid', heldReason: null },
    ],
    taxFormStatus: 'verified',
  },
}

const before: PartnerDashboard = {
  settings,
  code: {
    ...after.code!, paidSubs: 6, activeUsers: 21, pendingPaid: 3, freePlan: 'commissioner', cashOn: false, cashUnlockedAt: null, signups: 27,
    mix: [{ plan: 'AF Pro', month: 5, year: 0 }, { plan: 'AF Supreme', month: 1, year: 0 }],
    earnings: { thisMonthCents: 0, lifetimeCents: 0, paidOutCents: 0, pendingCents: 0 }, payouts: [], taxFormStatus: 'missing',
  },
}

export default async function PartnerCodesHarness(props: { searchParams?: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const view = ((await props.searchParams) ?? {}).view ?? 'after'
  if (view === 'calc') {
    const prices = { af_pro_monthly: 999, af_commissioner_monthly: 1499, af_supreme_monthly: 1999, af_pro_yearly: 7999, af_commissioner_yearly: 12999, af_supreme_yearly: 15999 }
    return <main className="min-h-dvh bg-[#0a0e1a] p-6 text-[#e8e9f5]"><div className="mx-auto max-w-[1120px]"><EarningsCalculator settings={S} prices={prices} /></div></main>
  }
  const pending: PartnerDashboard = { settings, code: { ...after.code!, logoStatus: 'pending', shareLogo: 'upload' } }
  const rejected: PartnerDashboard = { settings, code: { ...after.code!, logoStatus: 'rejected', shareLogo: 'initials', logoReviewNote: 'It looks like a team, league or brand logo. Use an image you own.' } }
  const data = view === 'claim' ? { settings, code: null } : view === 'before' ? before : view === 'logo-pending' ? pending : view === 'logo-rejected' ? rejected : after
  return <PartnerCodeDashboard initial={data} demo imageBase="/e2e/partner-codes/image" />
}
