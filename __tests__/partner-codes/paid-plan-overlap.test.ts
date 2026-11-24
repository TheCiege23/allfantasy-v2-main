import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Owner's rule: unlocking a free plan stops the paid plan it covers. Stripe renewals are turned off
 * (never cancelled immediately, never refunded); store-billed plans are left alone and emailed about.
 */

vi.mock('server-only', () => ({}))

const rows: Array<Record<string, unknown>> = []
vi.mock('@/lib/prisma', () => ({
  prisma: { userSubscription: { findMany: vi.fn(async () => rows) } },
}))

const FAR = new Date(Date.now() + 20 * 86_400_000)
const row = (over: Record<string, unknown>) => ({
  source: 'stripe', sku: 'af_supreme_monthly', status: 'active', currentPeriodEnd: FAR, gracePeriodEnd: null, expiresAt: null, canceledAt: null, stripeSubscriptionId: 'sub_1', ...over,
})

function stripeWith(subs: Record<string, { cancel_at_period_end?: boolean; status?: string; cancel_at?: number | null }>) {
  return {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => ({ id, status: 'active', cancel_at: null, cancel_at_period_end: false, metadata: {}, ...subs[id] })),
      update: vi.fn(async () => ({})),
    },
  } as any
}

describe('stopPaidPlansCoveredBy', () => {
  beforeEach(() => { rows.length = 0 })

  it('free Supreme turns off renewal of a paid Supreme, at period end only', async () => {
    rows.push(row({}))
    const stripe = stripeWith({})
    const { stopPaidPlansCoveredBy } = await import('@/lib/partner-codes/paidPlanOverlap')
    const r = await stopPaidPlansCoveredBy({ stripe, userId: 'u1', freePlan: 'supreme', partnerCodeId: 'pc1' })
    expect(stripe.subscriptions.update).toHaveBeenCalledWith('sub_1', expect.objectContaining({ cancel_at_period_end: true }))
    expect(stripe.subscriptions.update.mock.calls[0][1]).not.toHaveProperty('prorate')
    expect(r.stopped).toEqual([{ subscriptionId: 'sub_1', planFamily: 'af_supreme', endsAt: FAR }])
  })

  it('free Supreme also covers paid Pro and Commissioner, but never AF Legacy', async () => {
    rows.push(row({ sku: 'af_pro_monthly', stripeSubscriptionId: 'sub_pro' }), row({ sku: 'af_commissioner_yearly', stripeSubscriptionId: 'sub_c' }), row({ sku: 'af_war_room_monthly', stripeSubscriptionId: 'sub_legacy' }))
    const stripe = stripeWith({})
    const { stopPaidPlansCoveredBy } = await import('@/lib/partner-codes/paidPlanOverlap')
    const r = await stopPaidPlansCoveredBy({ stripe, userId: 'u1', freePlan: 'supreme', partnerCodeId: 'pc1' })
    expect(r.stopped.map((s) => s.subscriptionId).sort()).toEqual(['sub_c', 'sub_pro'])
  })

  it('free Commissioner leaves a paid Supreme alone (Supreme is more than it)', async () => {
    rows.push(row({}))
    const stripe = stripeWith({})
    const { stopPaidPlansCoveredBy } = await import('@/lib/partner-codes/paidPlanOverlap')
    const r = await stopPaidPlansCoveredBy({ stripe, userId: 'u1', freePlan: 'commissioner', partnerCodeId: 'pc1' })
    expect(stripe.subscriptions.update).not.toHaveBeenCalled()
    expect(r.stopped).toEqual([])
  })

  it('is idempotent: a subscription already ending is not touched again', async () => {
    rows.push(row({}))
    const stripe = stripeWith({ sub_1: { cancel_at_period_end: true } })
    const { stopPaidPlansCoveredBy } = await import('@/lib/partner-codes/paidPlanOverlap')
    const r = await stopPaidPlansCoveredBy({ stripe, userId: 'u1', freePlan: 'supreme', partnerCodeId: 'pc1' })
    expect(stripe.subscriptions.update).not.toHaveBeenCalled()
    expect(r.stopped).toEqual([])
  })

  it('an App Store plan is not cancelled by us; it is reported so the member can be told how', async () => {
    rows.push(row({ source: 'apple', stripeSubscriptionId: null }))
    const stripe = stripeWith({})
    const { stopPaidPlansCoveredBy, overlapEmail } = await import('@/lib/partner-codes/paidPlanOverlap')
    const r = await stopPaidPlansCoveredBy({ stripe, userId: 'u1', freePlan: 'supreme', partnerCodeId: 'pc1' })
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(r.storeOwned).toEqual([{ source: 'apple', planFamily: 'af_supreme' }])
    expect(overlapEmail('supreme', r)?.bodyHtml).toContain('App Store')
  })

  it('an expired paid plan is ignored, and nothing to do means no email', async () => {
    rows.push(row({ status: 'canceled', currentPeriodEnd: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() - 86_400_000) }))
    const stripe = stripeWith({})
    const { stopPaidPlansCoveredBy, overlapEmail } = await import('@/lib/partner-codes/paidPlanOverlap')
    const r = await stopPaidPlansCoveredBy({ stripe, userId: 'u1', freePlan: 'supreme', partnerCodeId: 'pc1' })
    expect(r).toEqual({ stopped: [], storeOwned: [] })
    expect(overlapEmail('supreme', r)).toBeNull()
  })
})
