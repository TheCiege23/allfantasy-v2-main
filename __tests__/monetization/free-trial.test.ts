// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The AF Pro free trial (2026-11-15): 7 days on AF Pro, card up front, once per account, web only.
 * The rules, the Stripe session it asks for, what the webhook writes and tells Meta, and the $0 invoice
 * that must not turn a trial into a paying subscriber.
 */

import {
  isTrialStartInvoice,
  readTrialDays,
  trialDaysForSku,
  trialDaysFromEnv,
  trialEndsAt,
} from '@/lib/monetization/freeTrial'

describe('the trial rules', () => {
  it('7 days by default; AF_PRO_TRIAL_DAYS dials it or switches it off', () => {
    expect(trialDaysFromEnv({})).toBe(7)
    expect(trialDaysFromEnv({ AF_PRO_TRIAL_DAYS: '14' })).toBe(14)
    expect(trialDaysFromEnv({ AF_PRO_TRIAL_DAYS: '90' })).toBe(30)
    expect(trialDaysFromEnv({ AF_PRO_TRIAL_DAYS: '0' })).toBe(0)
    expect(trialDaysFromEnv({ AF_PRO_TRIAL_DAYS: 'off' })).toBe(0)
    expect(trialDaysFromEnv({ AF_PRO_TRIAL_DAYS: 'banana' })).toBe(0)
  })

  it('AF Pro only — never Commissioner, Supreme, Legacy or a token pack', () => {
    expect(trialDaysForSku('af_pro_monthly', {})).toBe(7)
    expect(trialDaysForSku('af_pro_yearly', {})).toBe(7)
    for (const sku of ['af_commissioner_monthly', 'af_supreme_yearly', 'af_war_room_monthly', 'af_tokens_5', null]) {
      expect(trialDaysForSku(sku, {})).toBe(0)
    }
  })

  it('reads the metadata the checkout stamped, and nothing else', () => {
    expect(readTrialDays('7')).toBe(7)
    expect(readTrialDays(7)).toBe(7)
    expect(readTrialDays('0')).toBe(0)
    expect(readTrialDays('7.5')).toBe(0)
    expect(readTrialDays(undefined)).toBe(0)
    expect(readTrialDays('365')).toBe(0)
    expect(trialEndsAt(new Date('2026-11-15T00:00:00Z'), 7).toISOString()).toBe('2026-11-22T00:00:00.000Z')
  })

  it('🛑 the $0 invoice a trial opens with is not a payment; a real one is', () => {
    expect(isTrialStartInvoice({ billing_reason: 'subscription_create', amount_paid: 0 })).toBe(true)
    expect(isTrialStartInvoice({ billing_reason: 'subscription_create', amount_paid: 999 })).toBe(false)
    expect(isTrialStartInvoice({ billing_reason: 'subscription_cycle', amount_paid: 999 })).toBe(false)
  })
})

describe('eligibility — an account that has never subscribed, failing closed', () => {
  const count = vi.hoisted(() => vi.fn())
  beforeEach(() => {
    vi.resetModules()
    count.mockReset()
    vi.doMock('server-only', () => ({}))
    vi.doMock('@/lib/prisma', () => ({ prisma: { userSubscription: { count } } }))
  })

  it('never subscribed → the trial; any row → none; a read error → none', async () => {
    const { trialDaysForCheckout } = await import('@/lib/monetization/freeTrialEligibility')
    count.mockResolvedValueOnce(0)
    expect(await trialDaysForCheckout('u1', 'af_pro_monthly', {} as NodeJS.ProcessEnv)).toBe(7)
    count.mockResolvedValueOnce(1)
    expect(await trialDaysForCheckout('u1', 'af_pro_monthly', {} as NodeJS.ProcessEnv)).toBe(0)
    count.mockRejectedValueOnce(new Error('db down'))
    expect(await trialDaysForCheckout('u1', 'af_pro_monthly', {} as NodeJS.ProcessEnv)).toBe(0)
    // Not a trial SKU: the database is not even asked.
    expect(await trialDaysForCheckout('u1', 'af_commissioner_monthly', {} as NodeJS.ProcessEnv)).toBe(0)
    expect(count).toHaveBeenCalledTimes(3)
  })
})

describe('the Stripe session', () => {
  const create = vi.hoisted(() => vi.fn())
  beforeEach(() => {
    vi.resetModules()
    create.mockReset().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' })
    vi.doMock('server-only', () => ({}))
    vi.doMock('@/lib/stripe-client', () => ({ getStripeClient: () => ({ checkout: { sessions: { create } } }) }))
    vi.doMock('@/lib/get-base-url', () => ({ getBaseUrl: () => 'https://app.example.com' }))
    process.env.STRIPE_PRICE_AF_PRO_MONTHLY = 'price_pro_monthly_test'
  })

  it('asks Stripe for the trial, takes the card, and stamps the days for the webhook', async () => {
    const { buildStripeCheckoutSessionForSku } = await import('@/lib/monetization/StripeCheckoutSession')
    await buildStripeCheckoutSessionForSku({ sku: 'af_pro_monthly', userId: 'u1', trialDays: 7 })
    const params = create.mock.calls[0][0]
    expect(params.subscription_data.trial_period_days).toBe(7)
    expect(params.payment_method_collection).toBe('always')
    expect(params.metadata.trialDays).toBe('7')
    expect(params.subscription_data.metadata.trialDays).toBe('7')
  })

  it('no trial days → no trial at all', async () => {
    const { buildStripeCheckoutSessionForSku } = await import('@/lib/monetization/StripeCheckoutSession')
    await buildStripeCheckoutSessionForSku({ sku: 'af_pro_monthly', userId: 'u1' })
    const params = create.mock.calls[0][0]
    expect(params.subscription_data.trial_period_days).toBeUndefined()
    expect(params.metadata.trialDays).toBeUndefined()
  })
})

describe('the $0 trial invoice keeps the row trialing', () => {
  const updateMany = vi.hoisted(() => vi.fn())
  beforeEach(() => {
    vi.resetModules()
    updateMany.mockReset().mockResolvedValue({ count: 1 })
    vi.doMock('server-only', () => ({}))
    vi.doMock('@/lib/prisma', () => ({ prisma: { userSubscription: { updateMany } } }))
  })

  const invoice = (over: Record<string, unknown>) =>
    ({ id: 'in_1', customer: 'cus_1', parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [] }, ...over }) as never

  it('🛑 a trial-start invoice does not write `active`; a paid one does', async () => {
    const { refreshSubscriptionPeriod } = await import('@/lib/subscription/webhookHandlers')
    await refreshSubscriptionPeriod(invoice({ billing_reason: 'subscription_create', amount_paid: 0 }), 'u1')
    expect(updateMany.mock.calls[0][0].data.status).toBeUndefined()
    await refreshSubscriptionPeriod(invoice({ billing_reason: 'subscription_cycle', amount_paid: 999 }), 'u1')
    expect(updateMany.mock.calls[1][0].data.status).toBe('active')
  })
})

describe('the eligibility endpoint', () => {
  const session = vi.hoisted(() => vi.fn())
  const never = vi.hoisted(() => vi.fn())
  beforeEach(() => {
    vi.resetModules()
    session.mockReset()
    never.mockReset()
    vi.doMock('server-only', () => ({}))
    vi.doMock('next-auth', () => ({ getServerSession: session }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    vi.doMock('@/lib/monetization/freeTrialEligibility', () => ({ hasNeverSubscribed: never }))
    delete process.env.AF_PRO_TRIAL_DAYS
  })
  const get = async (ua = 'Mozilla/5.0 (Macintosh)') => {
    const { GET } = await import('@/app/api/monetization/trial-eligibility/route')
    return (await GET(new Request('https://x.test/api/monetization/trial-eligibility', { headers: { 'user-agent': ua } }))).json()
  }

  it('signed out → offered, eligibility unknown; never subscribed → eligible; subscribed → nothing', async () => {
    session.mockResolvedValue(null)
    expect(await get()).toEqual({ days: 7, skus: ['af_pro_monthly', 'af_pro_yearly'], eligible: null })
    session.mockResolvedValue({ user: { id: 'u1' } })
    never.mockResolvedValue(true)
    expect(await get()).toMatchObject({ days: 7, eligible: true })
    never.mockResolvedValue(false)
    expect(await get()).toEqual({ days: 0, skus: [], eligible: false })
  })

  it('🛑 the iOS app is never offered a web trial (App Store 3.1.1 / 3.1.3)', async () => {
    session.mockResolvedValue({ user: { id: 'u1' } })
    never.mockResolvedValue(true)
    vi.doMock('@/lib/monetization/isAppleIosShellRequest', () => ({ isAppleIosShellRequest: () => true }))
    expect(await get()).toEqual({ days: 0, skus: [], eligible: false })
    expect(never).not.toHaveBeenCalled()
  })
})
